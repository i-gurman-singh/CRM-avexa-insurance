import '@/lib/server-guard';
import { db } from '@/lib/db';
import { log } from '@/lib/logger';
import { JOB_TYPES, type JobHandler, type JobType } from '@/integrations/queue';
import { getWhatsApp } from '@/integrations/whatsapp';
import { analyzeMessage, processDocument } from '@/core/ai/service';
import { expireOldSuggestions } from '@/core/ai/suggestions';
import { storeDocument } from '@/core/documents/service';
import { sweepUnresponsiveClients } from '@/core/followups/service';
import { notifyDueFollowUps } from '@/core/notifications/service';
import { findStaleClients } from '@/core/pipeline/service';
import { setNeedsAttention } from '@/core/clients/service';
import { getSetting } from '@/core/settings/service';
import { buildContext, evaluateWorkflows } from '@/core/workflows/engine';

const logger = log('worker:handlers');

/**
 * Job handlers.
 *
 * Every handler must be safe to run twice: the queue guarantees at-least-once
 * delivery, not exactly-once. In practice that means checking current state
 * before acting (has this already been analysed? does this document already
 * exist?) rather than assuming a fresh start.
 */

const handlers: Partial<Record<JobType, JobHandler>> = {
  /**
   * Runs after an inbound message is stored. Kicks off AI understanding, which
   * in turn triggers the workflow engine.
   */
  [JOB_TYPES.PROCESS_INBOUND_MESSAGE]: async (payload: { messageId: string }) => {
    await analyzeMessage(payload.messageId);
  },

  [JOB_TYPES.ANALYZE_MESSAGE]: async (payload: { messageId: string }) => {
    await analyzeMessage(payload.messageId);
  },

  /**
   * Fetch a WhatsApp media file and turn it into a Document.
   * Kept separate from message analysis so a slow media download never blocks
   * classification of the accompanying text.
   */
  [JOB_TYPES.DOWNLOAD_MEDIA]: async (payload: {
    attachmentId: string;
    messageId: string;
    clientId: string;
  }) => {
    const attachment = await db.messageAttachment.findUnique({
      where: { id: payload.attachmentId },
    });
    if (!attachment) return;
    if (attachment.downloadStatus === 'PROCESSED' && attachment.storageKey) return;
    if (!attachment.externalMediaId) return;

    await db.messageAttachment.update({
      where: { id: attachment.id },
      data: { downloadStatus: 'PROCESSING' },
    });

    try {
      const media = await getWhatsApp().downloadMedia(attachment.externalMediaId);

      const filename =
        attachment.filename ??
        media.filename ??
        `whatsapp-${attachment.externalMediaId}.${extensionFor(media.mimeType)}`;

      await storeDocument({
        clientId: payload.clientId,
        body: media.body,
        filename,
        mimeType: attachment.mimeType ?? media.mimeType,
        source: 'whatsapp',
        messageId: payload.messageId,
        attachmentId: attachment.id,
      });
    } catch (e) {
      await db.messageAttachment.update({
        where: { id: attachment.id },
        data: { downloadStatus: 'FAILED' },
      });
      throw e;
    }
  },

  [JOB_TYPES.PROCESS_DOCUMENT]: async (payload: { documentId: string; force?: boolean }) => {
    await processDocument(payload.documentId, payload.force ?? false);
  },

  [JOB_TYPES.EVALUATE_WORKFLOWS]: async (payload: { messageId: string }) => {
    const ctx = await buildContext(payload.messageId);
    if (ctx) await evaluateWorkflows(ctx);
  },

  /**
   * Periodic sweep: clients who have gone quiet, follow-ups now due, and stale
   * suggestions. Scheduled by the worker loop rather than an external cron so
   * there is one less moving part to deploy.
   */
  [JOB_TYPES.SWEEP_FOLLOW_UPS]: async () => {
    const created = await sweepUnresponsiveClients();
    const notified = await notifyDueFollowUps();
    const expired = await expireOldSuggestions();
    logger.info({ created, notified, expired }, 'Follow-up sweep complete');
  },

  /** Flag clients who have been sitting in a stage past its SLA. */
  [JOB_TYPES.SWEEP_STALE_CLIENTS]: async () => {
    const defaultHours = await getSetting('pipeline.staleLeadHours');
    const stale = await findStaleClients(defaultHours);

    for (const item of stale) {
      await setNeedsAttention(
        item.clientId,
        true,
        `No movement in ${item.stageName} for ${item.hoursInStage}h`,
      );
    }

    logger.info({ flagged: stale.length }, 'Stale client sweep complete');
  },

  /** Outbound send queued from a workflow rule. */
  [JOB_TYPES.SEND_WHATSAPP_MESSAGE]: async (payload: { clientId: string; text: string }) => {
    const { sendMessage } = await import('@/core/messaging/service');
    const { SYSTEM_ACTOR } = await import('@/core/context');
    await sendMessage(SYSTEM_ACTOR, {
      clientId: payload.clientId,
      text: payload.text,
      isAutomated: true,
    });
  },
};

export function getHandler(type: JobType): JobHandler | null {
  return handlers[type] ?? null;
}

export const registeredJobTypes = Object.keys(handlers) as JobType[];

function extensionFor(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'video/mp4': 'mp4',
  };
  return map[mimeType] ?? 'bin';
}
