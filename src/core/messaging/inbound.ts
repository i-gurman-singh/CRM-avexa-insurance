import '@/lib/server-guard';
import { db } from '@/lib/db';
import { log, maskPhone } from '@/lib/logger';
import { normalizePhone } from '@/lib/utils';
import type {
  NormalizedInboundMessage,
  NormalizedStatusUpdate,
  NormalizedWebhookEvent,
} from '@/integrations/whatsapp';
import { enqueue, JOB_TYPES } from '@/integrations/queue';
import { findOrCreateClientByPhone } from '@/core/clients/service';
import { getSetting } from '@/core/settings/service';
import { ACTIVITY_TYPES, recordActivity } from '@/core/activity/service';
import { SYSTEM_ACTOR } from '@/core/context';
import { ensureConversation, toContentType } from './service';

const logger = log('messaging:inbound');

/**
 * Inbound message ingestion.
 *
 * Ordering is deliberate and load-bearing:
 *
 *   1. Persist the raw webhook payload and the message, verbatim.
 *   2. Return, so the provider gets its 200 immediately.
 *   3. Do AI analysis, media download and workflow evaluation in the worker.
 *
 * That means an OpenAI outage, a slow S3, or a bug in a workflow rule can
 * never cost us a customer's message. The message is already in Postgres.
 *
 * Duplicate delivery — which WhatsApp providers do routinely on retry — is
 * handled by two unique constraints: WebhookEvent(provider, externalId) and
 * Message(channel, externalId). Both are enforced by the database, not by
 * application logic that could race.
 */

export interface IngestResult {
  storedMessages: number;
  duplicateMessages: number;
  statusUpdates: number;
  createdClients: number;
}

export async function ingestWebhookEvent(
  provider: string,
  event: NormalizedWebhookEvent,
  rawBody: unknown,
): Promise<IngestResult> {
  const result: IngestResult = {
    storedMessages: 0,
    duplicateMessages: 0,
    statusUpdates: 0,
    createdClients: 0,
  };

  for (const message of event.messages) {
    const outcome = await ingestMessage(provider, message, rawBody);
    if (outcome === 'duplicate') result.duplicateMessages += 1;
    else {
      result.storedMessages += 1;
      if (outcome === 'stored_new_client') result.createdClients += 1;
    }
  }

  for (const status of event.statuses) {
    const applied = await applyStatusUpdate(status);
    if (applied) result.statusUpdates += 1;
  }

  return result;
}

type IngestOutcome = 'stored' | 'stored_new_client' | 'duplicate';

async function ingestMessage(
  provider: string,
  message: NormalizedInboundMessage,
  rawBody: unknown,
): Promise<IngestOutcome> {
  // Step 1: idempotency ledger. A unique violation here means the provider
  // has already delivered this event and we are done.
  try {
    await db.webhookEvent.create({
      data: {
        provider,
        externalId: message.externalId,
        eventType: 'message',
        payload: (message.raw ?? rawBody ?? {}) as object,
      },
    });
  } catch (e: any) {
    if (e?.code === 'P2002') {
      logger.debug({ externalId: message.externalId }, 'Duplicate webhook event ignored');
      return 'duplicate';
    }
    throw e;
  }

  const phone = normalizePhone(message.from);
  if (!phone) {
    logger.warn({ from: message.from }, 'Inbound message with unusable phone number');
    await markEventProcessed(provider, message.externalId, 'Unusable phone number');
    return 'duplicate';
  }

  const autoCreate = await getSetting('automation.autoCreateLeads');

  let clientId: string;
  let createdClient = false;

  const existing = await db.client.findUnique({ where: { phone } });
  if (existing) {
    clientId = existing.id;
  } else if (autoCreate) {
    const { client, created } = await findOrCreateClientByPhone(phone, {
      profileName: message.profileName,
    });
    clientId = client.id;
    createdClient = created;
  } else {
    // Lead creation is switched off: record the event and stop. The raw
    // payload is retained so nothing is lost if the setting is turned back on.
    logger.info({ phone: maskPhone(phone) }, 'Unknown number ignored (auto-create disabled)');
    await markEventProcessed(provider, message.externalId, 'Auto-create leads disabled');
    return 'duplicate';
  }

  const conversation = await ensureConversation(clientId, phone);
  const now = new Date();

  // Step 2: persist the message verbatim, before anything interprets it.
  let messageId: string;
  try {
    const created = await db.message.create({
      data: {
        conversationId: conversation.id,
        clientId,
        externalId: message.externalId,
        channel: 'WHATSAPP',
        direction: 'INBOUND',
        contentType: toContentType(message.type),
        body: message.text ?? null,
        rawPayload: (message.raw ?? {}) as object,
        deliveryStatus: 'DELIVERED',
        sentAt: message.timestamp ?? now,
        deliveredAt: now,
        isRead: false,
        mediaMeta: {
          profileName: message.profileName ?? null,
          attachmentCount: message.attachments.length,
          durations: message.attachments.map((a) => a.durationSeconds ?? null),
        } as object,
        attachments: {
          create: message.attachments.map((a) => ({
            externalMediaId: a.externalMediaId ?? null,
            mimeType: a.mimeType ?? null,
            filename: a.filename ?? null,
            sizeBytes: a.sizeBytes ?? null,
          })),
        },
      },
      include: { attachments: true },
    });
    messageId = created.id;

    // Denormalised counters that the dashboard and lists read.
    await db.$transaction([
      db.conversation.update({
        where: { id: conversation.id },
        data: {
          unreadCount: { increment: 1 },
          lastMessageAt: created.sentAt,
          lastInboundAt: created.sentAt,
          state: 'WAITING_ON_US',
        },
      }),
      db.client.update({
        where: { id: clientId },
        data: {
          unreadCount: { increment: 1 },
          lastInboundAt: created.sentAt,
          lastActivityAt: created.sentAt,
        },
      }),
    ]);

    await recordActivity({
      clientId,
      type: ACTIVITY_TYPES.MESSAGE_RECEIVED,
      title: describeInbound(message),
      body: message.text?.slice(0, 200),
      metadata: { type: message.type, attachments: message.attachments.length },
      actor: SYSTEM_ACTOR,
      actorType: 'client',
      entityType: 'Message',
      entityId: created.id,
    });

    // Step 3: hand off everything slow to the queue.
    for (const attachment of created.attachments) {
      if (!attachment.externalMediaId) continue;
      await enqueue(
        JOB_TYPES.DOWNLOAD_MEDIA,
        { attachmentId: attachment.id, messageId: created.id, clientId },
        { dedupeKey: `download-media:${attachment.id}`, priority: 5 },
      );
    }

    await enqueue(
      JOB_TYPES.PROCESS_INBOUND_MESSAGE,
      { messageId: created.id, clientId },
      { dedupeKey: `process-message:${created.id}`, priority: 10 },
    );
  } catch (e: any) {
    if (e?.code === 'P2002') {
      logger.debug({ externalId: message.externalId }, 'Duplicate message ignored');
      return 'duplicate';
    }
    throw e;
  }

  await markEventProcessed(provider, message.externalId);

  logger.info(
    { clientId, messageId, from: maskPhone(phone), type: message.type },
    'Inbound message stored',
  );

  return createdClient ? 'stored_new_client' : 'stored';
}

async function markEventProcessed(provider: string, externalId: string, error?: string) {
  await db.webhookEvent
    .update({
      where: { provider_externalId: { provider, externalId } },
      data: { processedAt: new Date(), error: error ?? null },
    })
    .catch(() => {
      /* best effort */
    });
}

/** Delivery receipts: sent / delivered / read / failed. */
async function applyStatusUpdate(status: NormalizedStatusUpdate): Promise<boolean> {
  const message = await db.message.findUnique({
    where: { channel_externalId: { channel: 'WHATSAPP', externalId: status.externalId } },
  });
  if (!message) return false;

  const rank = { PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 } as const;
  const next =
    status.status === 'delivered'
      ? 'DELIVERED'
      : status.status === 'read'
        ? 'READ'
        : status.status === 'failed'
          ? 'FAILED'
          : 'SENT';

  // Providers can deliver receipts out of order; never regress the status.
  if (next !== 'FAILED' && rank[next] <= rank[message.deliveryStatus]) return false;

  await db.message.update({
    where: { id: message.id },
    data: {
      deliveryStatus: next,
      deliveredAt: next === 'DELIVERED' ? (status.timestamp ?? new Date()) : message.deliveredAt,
      readAt: next === 'READ' ? (status.timestamp ?? new Date()) : message.readAt,
      errorMessage: status.errorMessage ?? null,
    },
  });

  return true;
}

function describeInbound(message: NormalizedInboundMessage): string {
  switch (message.type) {
    case 'image':
      return 'Received a photo on WhatsApp';
    case 'document':
      return `Received a document on WhatsApp${message.attachments[0]?.filename ? `: ${message.attachments[0].filename}` : ''}`;
    case 'audio':
      return 'Received a voice message on WhatsApp';
    case 'video':
      return 'Received a video on WhatsApp';
    case 'location':
      return 'Shared a location on WhatsApp';
    case 'contact':
      return 'Shared a contact on WhatsApp';
    default:
      return 'Received a WhatsApp message';
  }
}
