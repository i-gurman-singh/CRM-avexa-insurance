import '@/lib/server-guard';
import { db, type DbClient } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { log } from '@/lib/logger';
import type { Prisma, SuggestionKind } from '@/lib/types';
import { ACTIVITY_TYPES, recordActivity } from '@/core/activity/service';
import { recordAudit } from '@/core/audit/service';
import { actorUserId, requirePermission, type AnyActor } from '@/core/context';
import { moveClientToStage } from '@/core/pipeline/service';
import { createSystemTask } from '@/core/tasks/service';
import { createSystemFollowUp } from '@/core/followups/service';
import { applyFieldSuggestion } from '@/core/documents/apply';

const logger = log('ai:suggestions');

/**
 * The AI suggestion queue.
 *
 * Everything the model proposes that business rules did not auto-apply lands
 * here for a human. This is the mechanism that keeps automation useful without
 * letting it act unilaterally: staff see what the CRM wanted to do, and accept
 * or reject it in one click.
 */

export const suggestionInclude = {
  client: { select: { id: true, displayName: true, phone: true, stage: { select: { name: true, color: true } } } },
  message: { select: { id: true, body: true, sentAt: true } },
  document: { select: { id: true, filename: true } },
  reviewedByUser: { select: { id: true, name: true } },
} satisfies Prisma.AiSuggestionInclude;

export interface CreateSuggestionInput {
  clientId: string;
  kind: SuggestionKind;
  confidence: number;
  payload: Record<string, unknown>;
  rationale?: string;
  messageId?: string | null;
  documentId?: string | null;
  expiresInHours?: number;
}

export async function createSuggestion(
  input: CreateSuggestionInput,
  client: DbClient = db,
) {
  const suggestion = await client.aiSuggestion.create({
    data: {
      clientId: input.clientId,
      kind: input.kind,
      confidence: input.confidence,
      payload: input.payload as object,
      rationale: input.rationale ?? null,
      messageId: input.messageId ?? null,
      documentId: input.documentId ?? null,
      expiresAt: input.expiresInHours
        ? new Date(Date.now() + input.expiresInHours * 3600_000)
        : null,
    },
  });

  await recordActivity(
    {
      clientId: input.clientId,
      type: ACTIVITY_TYPES.AI_SUGGESTION_CREATED,
      title: `AI suggestion: ${describeKind(input.kind)}`,
      body: input.rationale,
      metadata: { kind: input.kind, confidence: input.confidence },
      actor: { id: 'system', name: 'AI', email: 'system@internal', role: 'ADMINISTRATOR', isSystem: true } as never,
      actorType: 'ai',
      entityType: 'AiSuggestion',
      entityId: suggestion.id,
    },
    client,
  );

  return suggestion;
}

export async function listSuggestions(opts: {
  clientId?: string;
  status?: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'AUTO_APPLIED';
  kind?: SuggestionKind;
  take?: number;
} = {}) {
  return db.aiSuggestion.findMany({
    where: {
      ...(opts.clientId ? { clientId: opts.clientId } : {}),
      status: opts.status ?? 'PENDING',
      ...(opts.kind ? { kind: opts.kind } : {}),
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
    take: opts.take ?? 100,
    include: suggestionInclude,
  });
}

export async function countPendingSuggestions() {
  return db.aiSuggestion.count({
    where: { status: 'PENDING', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
  });
}

/**
 * Accept a suggestion — this is where the proposal actually becomes an action.
 * Each kind maps to the same service a human would have used manually, so
 * there is no second, divergent code path.
 */
export async function acceptSuggestion(actor: AnyActor, suggestionId: string, notes?: string) {
  requirePermission(actor, 'ai.applySuggestions');

  const suggestion = await db.aiSuggestion.findUnique({ where: { id: suggestionId } });
  if (!suggestion) throw new NotFoundError('Suggestion');
  if (suggestion.status !== 'PENDING') return suggestion;

  const payload = suggestion.payload as Record<string, any>;

  switch (suggestion.kind) {
    case 'STAGE_CHANGE':
      await moveClientToStage(actor, {
        clientId: suggestion.clientId,
        toStageKey: payload.toStageKey,
        reason: suggestion.rationale ?? 'Accepted AI suggestion',
        changedBy: 'ai',
        confidence: suggestion.confidence,
      });
      break;

    case 'CREATE_TASK':
      await createSystemTask({
        clientId: suggestion.clientId,
        title: payload.title,
        description: payload.description,
        taskTypeKey: payload.taskTypeKey,
        priority: payload.priority,
        dueAt: payload.dueAt ? new Date(payload.dueAt) : undefined,
        assignedUserId: payload.assignedUserId ?? actorUserId(actor),
        dedupeKey: `suggestion:${suggestionId}`,
        createdBySystem: 'ai:accepted',
      });
      break;

    case 'CREATE_FOLLOW_UP':
      await createSystemFollowUp({
        clientId: suggestion.clientId,
        reasonKey: payload.reasonKey ?? 'manual',
        reason: payload.reason,
        dueAt: payload.dueAt ? new Date(payload.dueAt) : new Date(),
        priority: payload.priority,
        assignedUserId: payload.assignedUserId ?? actorUserId(actor),
        dedupeKey: `suggestion:${suggestionId}`,
        createdBySystem: 'ai:accepted',
      });
      break;

    case 'FIELD_UPDATE':
      // Delegated: it has its own provenance handling.
      return applyFieldSuggestion(actor, suggestionId).then(() =>
        db.aiSuggestion.findUnique({ where: { id: suggestionId } }),
      );

    case 'REQUEST_DOCUMENT': {
      const { requestDocuments } = await import('@/core/workflows/documentRequests');
      await requestDocuments(actor, suggestion.clientId, payload.documentTypeIds ?? [], {
        force: true,
      });
      break;
    }

    case 'TAG_CONVERSATION': {
      const { setConversationLabel } = await import('@/core/messaging/service');
      if (payload.conversationId && payload.label) {
        await setConversationLabel(payload.conversationId, payload.label, true);
      }
      break;
    }

    case 'REPLY_DRAFT':
      // Accepting a draft means "put it in the composer", which the UI does
      // client-side. Nothing to execute here.
      break;
  }

  const updated = await db.aiSuggestion.update({
    where: { id: suggestionId },
    data: {
      status: 'ACCEPTED',
      reviewedByUserId: actorUserId(actor),
      reviewedAt: new Date(),
      reviewNotes: notes ?? null,
    },
  });

  await recordActivity({
    clientId: suggestion.clientId,
    type: ACTIVITY_TYPES.AI_SUGGESTION_ACCEPTED,
    title: `Accepted: ${describeKind(suggestion.kind)}`,
    actor,
  });
  await recordAudit({
    actor,
    action: 'ai.acceptSuggestion',
    entityType: 'AiSuggestion',
    entityId: suggestionId,
    metadata: { kind: suggestion.kind },
  });

  return updated;
}

export async function rejectSuggestion(actor: AnyActor, suggestionId: string, notes?: string) {
  requirePermission(actor, 'ai.reviewSuggestions');

  const suggestion = await db.aiSuggestion.update({
    where: { id: suggestionId },
    data: {
      status: 'REJECTED',
      reviewedByUserId: actorUserId(actor),
      reviewedAt: new Date(),
      reviewNotes: notes ?? null,
    },
  });

  await recordActivity({
    clientId: suggestion.clientId,
    type: ACTIVITY_TYPES.AI_SUGGESTION_REJECTED,
    title: `Rejected: ${describeKind(suggestion.kind)}`,
    body: notes,
    actor,
  });
  await recordAudit({
    actor,
    action: 'ai.rejectSuggestion',
    entityType: 'AiSuggestion',
    entityId: suggestionId,
    metadata: { kind: suggestion.kind, notes },
  });

  return suggestion;
}

/** Mark a suggestion as applied by a rule rather than a person. */
export async function markAutoApplied(
  suggestionId: string,
  ruleKey: string,
  client: DbClient = db,
) {
  await client.aiSuggestion.update({
    where: { id: suggestionId },
    data: { status: 'AUTO_APPLIED', appliedByRule: ruleKey, reviewedAt: new Date() },
  });
}

/** Housekeeping: expire stale suggestions so the queue stays meaningful. */
export async function expireOldSuggestions(): Promise<number> {
  const { count } = await db.aiSuggestion.updateMany({
    where: { status: 'PENDING', expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  });
  if (count) logger.info({ count }, 'Expired stale AI suggestions');
  return count;
}

export function describeKind(kind: SuggestionKind): string {
  switch (kind) {
    case 'STAGE_CHANGE':
      return 'move to a different stage';
    case 'CREATE_TASK':
      return 'create a task';
    case 'CREATE_FOLLOW_UP':
      return 'schedule a follow-up';
    case 'REQUEST_DOCUMENT':
      return 'request documents';
    case 'FIELD_UPDATE':
      return 'update a field';
    case 'REPLY_DRAFT':
      return 'suggested reply';
    case 'TAG_CONVERSATION':
      return 'label the conversation';
    default:
      return 'suggestion';
  }
}
