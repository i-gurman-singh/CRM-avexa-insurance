import '@/lib/server-guard';
import { db, type DbClient } from '@/lib/db';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { log, maskPhone } from '@/lib/logger';
import type { ConversationState, MessageContentType, Prisma, Priority } from '@/lib/types';
import { getWhatsApp } from '@/integrations/whatsapp';
import { ACTIVITY_TYPES, recordActivity } from '@/core/activity/service';
import { recordAudit } from '@/core/audit/service';
import { actorUserId, requirePermission, type AnyActor } from '@/core/context';
import { getSetting } from '@/core/settings/service';

const logger = log('messaging');

/**
 * Conversations and messages.
 *
 * The CRM is channel-agnostic by construction: `Conversation.channel` is an
 * enum that already includes EMAIL and SMS, and nothing in this module assumes
 * WhatsApp beyond choosing which provider to send through. Adding email later
 * means implementing a provider and extending `sendMessage`.
 */

export const conversationInclude = {
  client: {
    select: {
      id: true,
      displayName: true,
      phone: true,
      needsAttention: true,
      attentionReason: true,
      assignedUser: { select: { id: true, name: true, avatarUrl: true } },
      stage: { select: { id: true, name: true, color: true, category: true } },
    },
  },
} satisfies Prisma.ConversationInclude;

export const messageInclude = {
  attachments: true,
  analysis: true,
  sentByUser: { select: { id: true, name: true, avatarUrl: true } },
  documents: { select: { id: true, filename: true, mimeType: true, documentTypeId: true } },
} satisfies Prisma.MessageInclude;

// ---------------------------------------------------------------------------
// Conversation monitoring
// ---------------------------------------------------------------------------

export type ConversationFilter =
  | 'all'
  | 'unread'
  | 'new'
  | 'needs_response'
  | 'stopped_responding'
  | 'price_objection'
  | 'ready_to_bind'
  | 'missing_documents'
  | 'high_priority'
  | 'ai_uncertain';

export interface ConversationQuery {
  filter?: ConversationFilter;
  assignedUserId?: string | null;
  search?: string;
  take?: number;
  skip?: number;
}

/**
 * Filters map to indexed columns and label arrays rather than to live AI calls
 * — the classification already happened when the message arrived.
 */
function filterWhere(filter: ConversationFilter | undefined): Prisma.ConversationWhereInput {
  const now = Date.now();
  switch (filter) {
    case 'unread':
      return { unreadCount: { gt: 0 } };
    case 'new':
      return { createdAt: { gte: new Date(now - 24 * 3600_000) } };
    case 'needs_response':
      return { state: 'WAITING_ON_US' };
    case 'stopped_responding':
      return {
        state: 'WAITING_ON_CLIENT',
        lastOutboundAt: { lt: new Date(now - 48 * 3600_000) },
      };
    case 'price_objection':
      return { labels: { has: 'price_objection' } };
    case 'ready_to_bind':
      return { labels: { has: 'ready_to_bind' } };
    case 'missing_documents':
      return { labels: { has: 'missing_documents' } };
    case 'high_priority':
      return { priority: { in: ['HIGH', 'URGENT'] } };
    case 'ai_uncertain':
      return { aiUncertain: true };
    default:
      return {};
  }
}

export async function listConversations(query: ConversationQuery = {}) {
  const where: Prisma.ConversationWhereInput = {
    ...filterWhere(query.filter),
    ...(query.assignedUserId !== undefined
      ? { client: { assignedUserId: query.assignedUserId } }
      : {}),
    ...(query.search
      ? {
          client: {
            OR: [
              { displayName: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search.replace(/\D/g, '') } },
            ],
          },
        }
      : {}),
    state: { not: 'CLOSED' },
  };

  const [items, total] = await Promise.all([
    db.conversation.findMany({
      where,
      orderBy: [{ isPinned: 'desc' }, { lastMessageAt: 'desc' }],
      take: query.take ?? 50,
      skip: query.skip ?? 0,
      include: {
        ...conversationInclude,
        messages: { orderBy: { sentAt: 'desc' }, take: 1, include: { analysis: true } },
      },
    }),
    db.conversation.count({ where }),
  ]);

  return { items, total };
}

/** Counts for the conversation filter chips. */
export async function conversationCounts(assignedUserId?: string | null) {
  const scope = assignedUserId !== undefined ? { client: { assignedUserId } } : {};
  const base: Prisma.ConversationWhereInput = { ...scope, state: { not: 'CLOSED' } };

  const filters: ConversationFilter[] = [
    'unread',
    'new',
    'needs_response',
    'stopped_responding',
    'price_objection',
    'ready_to_bind',
    'missing_documents',
    'high_priority',
    'ai_uncertain',
  ];

  const results = await Promise.all(
    filters.map((f) => db.conversation.count({ where: { ...base, ...filterWhere(f) } })),
  );
  const all = await db.conversation.count({ where: base });

  return {
    all,
    ...Object.fromEntries(filters.map((f, i) => [f, results[i] ?? 0])),
  } as Record<ConversationFilter, number>;
}

export async function getConversationForClient(clientId: string) {
  return db.conversation.findFirst({
    where: { clientId, channel: 'WHATSAPP' },
    include: conversationInclude,
  });
}

export async function listMessages(
  clientId: string,
  opts: { take?: number; before?: Date } = {},
) {
  const messages = await db.message.findMany({
    where: { clientId, ...(opts.before ? { sentAt: { lt: opts.before } } : {}) },
    orderBy: { sentAt: 'desc' },
    take: opts.take ?? 100,
    include: messageInclude,
  });
  // Return oldest-first for chat rendering.
  return messages.reverse();
}

// ---------------------------------------------------------------------------
// Conversation state
// ---------------------------------------------------------------------------

export async function markConversationRead(actor: AnyActor, conversationId: string) {
  requirePermission(actor, 'messages.view');

  const conversation = await db.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) throw new NotFoundError('Conversation');

  await db.$transaction([
    db.message.updateMany({
      where: { conversationId, direction: 'INBOUND', isRead: false },
      data: { isRead: true, readAt: new Date() },
    }),
    db.conversation.update({ where: { id: conversationId }, data: { unreadCount: 0 } }),
    db.client.update({ where: { id: conversation.clientId }, data: { unreadCount: 0 } }),
  ]);

  return { ok: true };
}

export async function setConversationState(
  actor: AnyActor,
  conversationId: string,
  state: ConversationState,
) {
  requirePermission(actor, 'messages.view');
  return db.conversation.update({ where: { id: conversationId }, data: { state } });
}

export async function setConversationPriority(
  actor: AnyActor,
  conversationId: string,
  priority: Priority,
) {
  requirePermission(actor, 'messages.view');
  return db.conversation.update({ where: { id: conversationId }, data: { priority } });
}

export async function toggleConversationPin(actor: AnyActor, conversationId: string, isPinned: boolean) {
  requirePermission(actor, 'messages.view');
  return db.conversation.update({ where: { id: conversationId }, data: { isPinned } });
}

/** Add or remove a label used by the monitoring filters. */
export async function setConversationLabel(
  conversationId: string,
  label: string,
  present: boolean,
  client: DbClient = db,
) {
  const conversation = await client.conversation.findUnique({
    where: { id: conversationId },
    select: { labels: true },
  });
  if (!conversation) return;

  const has = conversation.labels.includes(label);
  if (has === present) return;

  const labels = present
    ? [...conversation.labels, label]
    : conversation.labels.filter((l) => l !== label);

  await client.conversation.update({ where: { id: conversationId }, data: { labels } });
}

// ---------------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------------

export interface SendMessageInput {
  clientId: string;
  text: string;
  replyToExternalId?: string;
  /** True when a workflow rule is sending, not a person. */
  isAutomated?: boolean;
}

/**
 * Send a WhatsApp message and record it.
 *
 * The message row is written before the provider call so a failed send is
 * visible in the conversation as FAILED rather than disappearing. Automated
 * sends additionally respect the AUTOMATION_OUTBOUND_ENABLED kill switch.
 */
export async function sendMessage(actor: AnyActor, input: SendMessageInput) {
  if (!input.isAutomated) requirePermission(actor, 'messages.send');

  const text = input.text.trim();
  if (!text) throw new ConflictError('Message cannot be empty');
  if (text.length > 4096) throw new ConflictError('WhatsApp messages are limited to 4096 characters');

  const client = await db.client.findUnique({ where: { id: input.clientId } });
  if (!client) throw new NotFoundError('Client');

  const conversation = await ensureConversation(client.id, client.phone);
  const clearUnread = await shouldClearUnread();

  const message = await db.message.create({
    data: {
      conversationId: conversation.id,
      clientId: client.id,
      channel: 'WHATSAPP',
      direction: 'OUTBOUND',
      contentType: 'TEXT',
      body: text,
      rawPayload: {},
      sentByUserId: actorUserId(actor),
      isAutomated: input.isAutomated ?? false,
      deliveryStatus: 'PENDING',
      sentAt: new Date(),
      isRead: true,
    },
    include: messageInclude,
  });

  try {
    const result = await getWhatsApp().sendText({
      to: client.phone,
      text,
      replyToExternalId: input.replyToExternalId,
    });

    const updated = await db.message.update({
      where: { id: message.id },
      data: { externalId: result.externalId, deliveryStatus: 'SENT' },
      include: messageInclude,
    });

    const now = new Date();
    await db.$transaction([
      db.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: now,
          lastOutboundAt: now,
          state: 'WAITING_ON_CLIENT',
          ...(clearUnread ? { unreadCount: 0 } : {}),
        },
      }),
      db.client.update({
        where: { id: client.id },
        data: {
          lastOutboundAt: now,
          lastActivityAt: now,
          needsAttention: false,
          attentionReason: null,
          ...(clearUnread ? { unreadCount: 0 } : {}),
        },
      }),
    ]);

    await recordActivity({
      clientId: client.id,
      type: ACTIVITY_TYPES.MESSAGE_SENT,
      title: input.isAutomated ? 'Automated WhatsApp message sent' : 'WhatsApp message sent',
      body: text.slice(0, 200),
      actor,
      actorType: input.isAutomated ? 'workflow' : 'user',
      entityType: 'Message',
      entityId: message.id,
    });

    await recordAudit({
      actor,
      action: 'message.send',
      entityType: 'Message',
      entityId: message.id,
      metadata: { clientId: client.id, automated: input.isAutomated ?? false },
    });

    logger.info({ clientId: client.id, to: maskPhone(client.phone) }, 'Message sent');
    return updated;
  } catch (e) {
    await db.message.update({
      where: { id: message.id },
      data: {
        deliveryStatus: 'FAILED',
        errorMessage: e instanceof Error ? e.message.slice(0, 500) : 'Send failed',
      },
    });
    logger.error({ err: e, clientId: client.id }, 'Message send failed');
    throw e;
  }
}

async function shouldClearUnread() {
  return getSetting('automation.autoMarkReadOnReply');
}

/** Send a pre-approved WhatsApp template (needed outside the 24-hour window). */
export async function sendTemplate(
  actor: AnyActor,
  clientId: string,
  templateName: string,
  variables: string[] = [],
) {
  requirePermission(actor, 'messages.sendTemplate');

  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) throw new NotFoundError('Client');

  const conversation = await ensureConversation(client.id, client.phone);
  const result = await getWhatsApp().sendTemplate({ to: client.phone, templateName, variables });

  const message = await db.message.create({
    data: {
      conversationId: conversation.id,
      clientId: client.id,
      channel: 'WHATSAPP',
      direction: 'OUTBOUND',
      contentType: 'TEMPLATE',
      body: `[template:${templateName}] ${variables.join(' | ')}`,
      rawPayload: { templateName, variables },
      externalId: result.externalId,
      sentByUserId: actorUserId(actor),
      deliveryStatus: 'SENT',
      sentAt: new Date(),
      isRead: true,
    },
    include: messageInclude,
  });

  await recordAudit({
    actor,
    action: 'message.sendTemplate',
    entityType: 'Message',
    entityId: message.id,
    metadata: { templateName },
  });

  return message;
}

/** Find or create the conversation row for a client's phone number. */
export async function ensureConversation(
  clientId: string,
  phone: string,
  client: DbClient = db,
  inboxId = 'default',
) {
  const existing = await client.conversation.findUnique({
    where: { channel_externalId_inboxId: { channel: 'WHATSAPP', externalId: phone, inboxId } },
  });
  if (existing) return existing;

  try {
    return await client.conversation.create({
      data: { clientId, channel: 'WHATSAPP', externalId: phone, inboxId },
    });
  } catch (e: any) {
    // Lost a race with a concurrent inbound message — re-read.
    if (e?.code === 'P2002') {
      const found = await client.conversation.findUnique({
        where: { channel_externalId_inboxId: { channel: 'WHATSAPP', externalId: phone, inboxId } },
      });
      if (found) return found;
    }
    throw e;
  }
}

/** Map a provider content type to our enum. */
export function toContentType(type: string): MessageContentType {
  switch (type) {
    case 'text':
      return 'TEXT';
    case 'image':
      return 'IMAGE';
    case 'document':
      return 'DOCUMENT';
    case 'audio':
      return 'AUDIO';
    case 'video':
      return 'VIDEO';
    case 'location':
      return 'LOCATION';
    case 'contact':
      return 'CONTACT';
    case 'sticker':
      return 'STICKER';
    case 'template':
      return 'TEMPLATE';
    case 'system':
      return 'SYSTEM';
    default:
      return 'UNKNOWN';
  }
}
