import '@/lib/server-guard';
import { db, type DbClient } from '@/lib/db';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { log } from '@/lib/logger';
import type { PipelineStage } from '@/lib/types';
import { ACTIVITY_TYPES, recordActivity } from '@/core/activity/service';
import { recordAudit } from '@/core/audit/service';
import { actorUserId, isSystemActor, requirePermission, type AnyActor } from '@/core/context';
import { getStageByKey, listStages } from '@/core/settings/lookups';

const logger = log('pipeline');

/**
 * Pipeline movement.
 *
 * Every stage change flows through `moveClientToStage`, whether it came from a
 * drag on the board, a dropdown, a workflow rule, or an accepted AI suggestion.
 * That single entry point is what guarantees history, the timeline entry, the
 * audit record and the time-in-stage metric are always written together.
 */

export type StageChangeSource = 'manual' | 'ai' | 'workflow' | 'system';

export interface MoveStageInput {
  clientId: string;
  /** Target stage — pass either. */
  toStageId?: string;
  toStageKey?: string;
  reason?: string;
  changedBy?: StageChangeSource;
  confidence?: number;
  /** Set when moving to a LOST stage. */
  lostReasonId?: string | null;
  lostNotes?: string | null;
}

export interface MoveStageResult {
  moved: boolean;
  fromStage: PipelineStage | null;
  toStage: PipelineStage;
}

export async function moveClientToStage(
  actor: AnyActor,
  input: MoveStageInput,
  client: DbClient = db,
): Promise<MoveStageResult> {
  requirePermission(actor, 'pipeline.move');

  const existing = await client.client.findUnique({
    where: { id: input.clientId },
    include: { stage: true },
  });
  if (!existing) throw new NotFoundError('Client');

  const target = input.toStageId
    ? await client.pipelineStage.findUnique({ where: { id: input.toStageId } })
    : input.toStageKey
      ? await client.pipelineStage.findUnique({ where: { key: input.toStageKey } })
      : null;

  if (!target) throw new NotFoundError('Stage');
  if (!target.isActive) throw new ConflictError(`"${target.name}" is no longer an active stage`);

  // Idempotent: moving to the current stage is a no-op, not an error. Workflow
  // rules rely on this so they can be evaluated repeatedly without churn.
  if (existing.stageId === target.id) {
    return { moved: false, fromStage: existing.stage, toStage: target };
  }

  const now = new Date();
  const durationSeconds = Math.max(
    0,
    Math.round((now.getTime() - existing.stageEnteredAt.getTime()) / 1000),
  );

  await client.$transaction(async (tx) => {
    await tx.client.update({
      where: { id: existing.id },
      data: {
        stageId: target.id,
        stageEnteredAt: now,
        lastActivityAt: now,
        // Clear the "needs attention" flag: the stage move is the response.
        needsAttention: false,
        attentionReason: null,
        ...(target.category === 'LOST'
          ? { lostReasonId: input.lostReasonId ?? existing.lostReasonId, lostNotes: input.lostNotes ?? existing.lostNotes }
          : { lostReasonId: null, lostNotes: null }),
      },
    });

    await tx.clientStageHistory.create({
      data: {
        clientId: existing.id,
        fromStageId: existing.stageId,
        toStageId: target.id,
        changedByUserId: actorUserId(actor),
        changedBy: input.changedBy ?? (isSystemActor(actor) ? 'system' : 'manual'),
        reason: input.reason ?? null,
        confidence: input.confidence ?? null,
        durationSeconds,
      },
    });
  });

  await recordActivity(
    {
      clientId: existing.id,
      type: ACTIVITY_TYPES.STAGE_CHANGED,
      title: `Moved to ${target.name}`,
      body: input.reason ?? undefined,
      metadata: {
        from: existing.stage.name,
        to: target.name,
        changedBy: input.changedBy ?? 'manual',
        confidence: input.confidence,
      },
      actor,
      actorType:
        input.changedBy === 'ai' ? 'ai' : input.changedBy === 'workflow' ? 'workflow' : undefined,
      entityType: 'PipelineStage',
      entityId: target.id,
    },
    client,
  );

  if (target.category === 'LOST') {
    await recordActivity(
      {
        clientId: existing.id,
        type: ACTIVITY_TYPES.LOST,
        title: 'Marked as lost',
        body: input.lostNotes ?? undefined,
        actor,
      },
      client,
    );
  }

  await recordAudit({
    actor,
    action: 'client.stageChange',
    entityType: 'Client',
    entityId: existing.id,
    metadata: { from: existing.stage.key, to: target.key, changedBy: input.changedBy ?? 'manual' },
  });

  logger.info(
    { clientId: existing.id, from: existing.stage.key, to: target.key, by: input.changedBy },
    'Client stage changed',
  );

  return { moved: true, fromStage: existing.stage, toStage: target };
}

/**
 * The Kanban board: stages with their clients.
 * `limitPerStage` keeps the payload sane on a busy pipeline; the UI offers
 * "show all" per column.
 */
export async function getPipelineBoard(opts: {
  assignedUserId?: string;
  limitPerStage?: number;
  search?: string;
} = {}) {
  const stages = await listStages();
  const limit = opts.limitPerStage ?? 50;

  const where = {
    isArchived: false,
    ...(opts.assignedUserId ? { assignedUserId: opts.assignedUserId } : {}),
    ...(opts.search
      ? {
          OR: [
            { displayName: { contains: opts.search, mode: 'insensitive' as const } },
            { phone: { contains: opts.search } },
            { email: { contains: opts.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [clients, counts] = await Promise.all([
    db.client.findMany({
      where,
      orderBy: { lastActivityAt: 'desc' },
      include: {
        assignedUser: { select: { id: true, name: true, avatarUrl: true } },
        _count: { select: { quotes: true, documents: true } },
      },
      // Fetch enough rows to fill every column, then bucket in memory.
      take: limit * Math.max(stages.length, 1),
    }),
    db.client.groupBy({ by: ['stageId'], where, _count: { _all: true } }),
  ]);

  const countByStage = new Map(counts.map((c) => [c.stageId, c._count._all]));

  return stages.map((stage) => ({
    stage,
    total: countByStage.get(stage.id) ?? 0,
    clients: clients.filter((c) => c.stageId === stage.id).slice(0, limit),
  }));
}

/** Clients sitting in a stage longer than its SLA. */
export async function findStaleClients(defaultStaleHours: number) {
  const stages = await listStages();
  const now = Date.now();

  const results: Array<{ clientId: string; stageName: string; hoursInStage: number }> = [];

  for (const stage of stages) {
    if (stage.category !== 'OPEN') continue;
    const thresholdHours = stage.staleAfterHours ?? defaultStaleHours;
    const cutoff = new Date(now - thresholdHours * 3600_000);

    const clients = await db.client.findMany({
      where: { stageId: stage.id, isArchived: false, stageEnteredAt: { lt: cutoff } },
      select: { id: true, stageEnteredAt: true },
    });

    for (const c of clients) {
      results.push({
        clientId: c.id,
        stageName: stage.name,
        hoursInStage: Math.round((now - c.stageEnteredAt.getTime()) / 3600_000),
      });
    }
  }

  return results;
}

export { getStageByKey };
