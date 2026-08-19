import '@/lib/server-guard';
import { db, type DbClient } from '@/lib/db';
import { log } from '@/lib/logger';
import { actorUserId, isSystemActor, type AnyActor } from '@/core/context';

const logger = log('activity');

/**
 * The client activity timeline.
 *
 * Append-only, human-readable history of everything that happened to a client:
 * lead created, message received, licence extracted, quote sent, stage moved,
 * policy bound. Staff open one screen and understand the whole file.
 *
 * Events are written by services as a side effect of the real operation. They
 * are never the source of truth — deleting the timeline would lose history but
 * not break the CRM.
 */

export const ACTIVITY_TYPES = {
  CLIENT_CREATED: 'client.created',
  CLIENT_UPDATED: 'client.updated',
  CLIENT_ASSIGNED: 'client.assigned',
  STAGE_CHANGED: 'stage.changed',

  MESSAGE_RECEIVED: 'message.received',
  MESSAGE_SENT: 'message.sent',

  AI_ANALYSED_MESSAGE: 'ai.message_analysed',
  AI_EXTRACTED_DOCUMENT: 'ai.document_extracted',
  AI_SUGGESTION_CREATED: 'ai.suggestion_created',
  AI_SUGGESTION_ACCEPTED: 'ai.suggestion_accepted',
  AI_SUGGESTION_REJECTED: 'ai.suggestion_rejected',

  DOCUMENT_REQUESTED: 'document.requested',
  DOCUMENT_RECEIVED: 'document.received',
  DOCUMENT_VERIFIED: 'document.verified',
  DOCUMENT_REJECTED: 'document.rejected',

  QUOTE_CREATED: 'quote.created',
  QUOTE_UPDATED: 'quote.updated',
  QUOTE_SENT: 'quote.sent',
  QUOTE_SELECTED: 'quote.selected',

  POLICY_CREATED: 'policy.created',
  POLICY_BOUND: 'policy.bound',
  POLICY_UPDATED: 'policy.updated',

  TASK_CREATED: 'task.created',
  TASK_COMPLETED: 'task.completed',

  FOLLOW_UP_CREATED: 'followup.created',
  FOLLOW_UP_COMPLETED: 'followup.completed',

  NOTE_ADDED: 'note.added',
  LOST: 'client.lost',
} as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[keyof typeof ACTIVITY_TYPES];

export interface RecordActivityInput {
  clientId: string;
  type: ActivityType | string;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  actor: AnyActor;
  /** Override the actor type — e.g. 'client' for an inbound message, 'ai'. */
  actorType?: 'user' | 'ai' | 'workflow' | 'system' | 'client';
  entityType?: string;
  entityId?: string;
}

/** Never throws — a missing timeline entry must not fail the real operation. */
export async function recordActivity(
  input: RecordActivityInput,
  client: DbClient = db,
): Promise<void> {
  try {
    await client.activityEvent.create({
      data: {
        clientId: input.clientId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        metadata: (input.metadata ?? {}) as object,
        actorType: input.actorType ?? (isSystemActor(input.actor) ? 'system' : 'user'),
        actorId: actorUserId(input.actor),
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
      },
    });
  } catch (e) {
    logger.error({ err: e, clientId: input.clientId, type: input.type }, 'Failed to record activity');
  }
}

export async function listActivity(clientId: string, opts: { take?: number; skip?: number } = {}) {
  return db.activityEvent.findMany({
    where: { clientId },
    orderBy: { createdAt: 'desc' },
    take: opts.take ?? 100,
    skip: opts.skip ?? 0,
    include: { actorUser: { select: { id: true, name: true, avatarUrl: true } } },
  });
}
