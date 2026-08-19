import '@/lib/server-guard';
import { z } from 'zod';
import { db, type DbClient } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import type { FollowUpStatus, Prisma, Priority } from '@/lib/types';
import { addDays, addHours, endOfDay, startOfDay } from '@/lib/utils';
import { ACTIVITY_TYPES, recordActivity } from '@/core/activity/service';
import { recordAudit } from '@/core/audit/service';
import { actorUserId, requirePermission, type AnyActor } from '@/core/context';
import { getSetting } from '@/core/settings/service';

/**
 * Follow-ups.
 *
 * Kept separate from tasks on purpose. A task is "something to do"; a follow-up
 * is "get back to this client, for this reason, at this time". They have
 * different lists, different urgency and different analytics, and conflating
 * them was the main thing that made the previous spreadsheet unusable.
 */

export const FOLLOW_UP_REASONS = {
  QUOTE_NO_RESPONSE: 'quote_no_response',
  PRICE_OBJECTION: 'price_objection',
  THINKING_ABOUT_IT: 'thinking_about_it',
  MISSING_INFORMATION: 'missing_information',
  MISSING_DOCUMENTS: 'missing_documents',
  CALL_LATER: 'call_later',
  RENEWAL_APPROACHING: 'renewal_approaching',
  STOPPED_RESPONDING: 'stopped_responding',
  MANUAL: 'manual',
} as const;

export type FollowUpReason = (typeof FOLLOW_UP_REASONS)[keyof typeof FOLLOW_UP_REASONS];

export const FOLLOW_UP_REASON_LABELS: Record<string, string> = {
  [FOLLOW_UP_REASONS.QUOTE_NO_RESPONSE]: 'Quote sent, no response',
  [FOLLOW_UP_REASONS.PRICE_OBJECTION]: 'Said the price was too high',
  [FOLLOW_UP_REASONS.THINKING_ABOUT_IT]: 'Asked to think about it',
  [FOLLOW_UP_REASONS.MISSING_INFORMATION]: 'Missing information',
  [FOLLOW_UP_REASONS.MISSING_DOCUMENTS]: 'Missing documents',
  [FOLLOW_UP_REASONS.CALL_LATER]: 'Asked to be called later',
  [FOLLOW_UP_REASONS.RENEWAL_APPROACHING]: 'Renewal approaching',
  [FOLLOW_UP_REASONS.STOPPED_RESPONDING]: 'Stopped responding',
  [FOLLOW_UP_REASONS.MANUAL]: 'Manual follow-up',
};

export const followUpSchema = z.object({
  reasonKey: z.string().default(FOLLOW_UP_REASONS.MANUAL),
  reason: z.string().trim().max(500).optional().nullable(),
  dueAt: z.union([z.string(), z.date()]).transform((v) => new Date(v)),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  assignedUserId: z.string().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export type FollowUpInput = z.input<typeof followUpSchema>;

export const followUpInclude = {
  client: {
    select: {
      id: true,
      displayName: true,
      phone: true,
      unreadCount: true,
      stage: { select: { name: true, color: true } },
    },
  },
  assignedUser: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.FollowUpInclude;

export type FollowUpBucket = 'today' | 'overdue' | 'upcoming' | 'completed' | 'all';

export interface FollowUpQuery {
  bucket?: FollowUpBucket;
  assignedUserId?: string | null;
  clientId?: string;
  reasonKey?: string;
  take?: number;
  skip?: number;
}

function bucketWhere(bucket: FollowUpBucket | undefined, now: Date): Prisma.FollowUpWhereInput {
  switch (bucket) {
    case 'today':
      return { status: 'SCHEDULED', dueAt: { gte: startOfDay(now), lte: endOfDay(now) } };
    case 'overdue':
      return { status: 'SCHEDULED', dueAt: { lt: startOfDay(now) } };
    case 'upcoming':
      return { status: 'SCHEDULED', dueAt: { gt: endOfDay(now) } };
    case 'completed':
      return { status: 'DONE' };
    default:
      return {};
  }
}

export async function listFollowUps(query: FollowUpQuery = {}) {
  const now = new Date();
  const where: Prisma.FollowUpWhereInput = {
    ...bucketWhere(query.bucket, now),
    ...(query.assignedUserId !== undefined ? { assignedUserId: query.assignedUserId } : {}),
    ...(query.clientId ? { clientId: query.clientId } : {}),
    ...(query.reasonKey ? { reasonKey: query.reasonKey } : {}),
  };

  const [items, total] = await Promise.all([
    db.followUp.findMany({
      where,
      orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
      take: query.take ?? 100,
      skip: query.skip ?? 0,
      include: followUpInclude,
    }),
    db.followUp.count({ where }),
  ]);

  return { items, total };
}

export async function followUpCounts(assignedUserId?: string | null) {
  const now = new Date();
  const scope = assignedUserId !== undefined ? { assignedUserId } : {};

  const [today, overdue, upcoming] = await Promise.all([
    db.followUp.count({ where: { ...scope, ...bucketWhere('today', now) } }),
    db.followUp.count({ where: { ...scope, ...bucketWhere('overdue', now) } }),
    db.followUp.count({ where: { ...scope, ...bucketWhere('upcoming', now) } }),
  ]);

  return { today, overdue, upcoming };
}

export async function createFollowUp(actor: AnyActor, clientId: string, rawInput: unknown) {
  requirePermission(actor, 'followups.create');
  const input = followUpSchema.parse(rawInput);

  const followUp = await db.followUp.create({
    data: {
      clientId,
      reasonKey: input.reasonKey,
      reason: input.reason ?? FOLLOW_UP_REASON_LABELS[input.reasonKey] ?? null,
      dueAt: input.dueAt,
      priority: input.priority,
      assignedUserId: input.assignedUserId ?? null,
      notes: input.notes ?? null,
      createdBySystem: 'manual',
    },
    include: followUpInclude,
  });

  await recordActivity({
    clientId,
    type: ACTIVITY_TYPES.FOLLOW_UP_CREATED,
    title: `Follow-up scheduled: ${followUp.reason ?? input.reasonKey}`,
    body: `Due ${input.dueAt.toLocaleString()}`,
    actor,
    entityType: 'FollowUp',
    entityId: followUp.id,
  });
  await recordAudit({ actor, action: 'followUp.create', entityType: 'FollowUp', entityId: followUp.id });
  return followUp;
}

export interface SystemFollowUpInput {
  clientId: string;
  reasonKey: FollowUpReason | string;
  reason?: string;
  dueAt: Date;
  priority?: Priority;
  assignedUserId?: string | null;
  dedupeKey: string;
  createdBySystem: string;
  notes?: string;
}

/**
 * Create a follow-up from a workflow rule. Idempotent via `dedupeKey`; if one
 * already exists and is still scheduled, the due date is moved earlier only
 * (never later), so a fresh signal can bring attention forward but repeated
 * signals cannot push a follow-up out indefinitely.
 */
export async function createSystemFollowUp(
  input: SystemFollowUpInput,
  client: DbClient = db,
): Promise<{ id: string; created: boolean } | null> {
  const existing = await client.followUp.findUnique({ where: { dedupeKey: input.dedupeKey } });

  if (existing) {
    if (existing.status !== 'SCHEDULED') return null;
    if (input.dueAt < existing.dueAt) {
      await client.followUp.update({ where: { id: existing.id }, data: { dueAt: input.dueAt } });
    }
    return { id: existing.id, created: false };
  }

  try {
    const created = await client.followUp.create({
      data: {
        clientId: input.clientId,
        reasonKey: input.reasonKey,
        reason: input.reason ?? FOLLOW_UP_REASON_LABELS[input.reasonKey] ?? null,
        dueAt: input.dueAt,
        priority: input.priority ?? 'NORMAL',
        assignedUserId: input.assignedUserId ?? null,
        notes: input.notes ?? null,
        createdBySystem: input.createdBySystem,
        dedupeKey: input.dedupeKey,
      },
    });
    return { id: created.id, created: true };
  } catch (e: any) {
    if (e?.code === 'P2002') return null;
    throw e;
  }
}

export async function updateFollowUp(actor: AnyActor, id: string, rawInput: unknown) {
  requirePermission(actor, 'followups.update');
  const input = followUpSchema.partial().parse(rawInput);
  const updated = await db.followUp.update({ where: { id }, data: input, include: followUpInclude });
  await recordAudit({ actor, action: 'followUp.update', entityType: 'FollowUp', entityId: id });
  return updated;
}

export async function completeFollowUp(actor: AnyActor, id: string, outcome?: string) {
  requirePermission(actor, 'followups.update');

  const existing = await db.followUp.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Follow-up');

  const followUp = await db.followUp.update({
    where: { id },
    data: { status: 'DONE', completedAt: new Date(), outcome: outcome ?? null },
    include: followUpInclude,
  });

  await recordActivity({
    clientId: followUp.clientId,
    type: ACTIVITY_TYPES.FOLLOW_UP_COMPLETED,
    title: 'Follow-up completed',
    body: outcome,
    actor,
    entityType: 'FollowUp',
    entityId: id,
  });
  await recordAudit({ actor, action: 'followUp.complete', entityType: 'FollowUp', entityId: id });
  return followUp;
}

export async function snoozeFollowUp(actor: AnyActor, id: string, until: Date) {
  requirePermission(actor, 'followups.update');
  const followUp = await db.followUp.update({
    where: { id },
    data: { dueAt: until, snoozedUntil: until, status: 'SCHEDULED' },
    include: followUpInclude,
  });
  await recordAudit({ actor, action: 'followUp.snooze', entityType: 'FollowUp', entityId: id, metadata: { until } });
  return followUp;
}

export async function setFollowUpStatus(actor: AnyActor, id: string, status: FollowUpStatus) {
  requirePermission(actor, 'followups.update');
  return db.followUp.update({ where: { id }, data: { status }, include: followUpInclude });
}

export async function deleteFollowUp(actor: AnyActor, id: string) {
  requirePermission(actor, 'followups.delete');
  const followUp = await db.followUp.delete({ where: { id } });
  await recordAudit({ actor, action: 'followUp.delete', entityType: 'FollowUp', entityId: id });
  return followUp;
}

/**
 * Background sweep: find clients who have gone quiet and schedule a follow-up.
 * Run periodically by the worker.
 */
export async function sweepUnresponsiveClients(): Promise<number> {
  const hours = await getSetting('followups.noResponseAfterHours');
  const cutoff = addHours(new Date(), -hours);

  // Clients we spoke to last, who have not replied since, and who are still in
  // an open stage.
  const candidates = await db.client.findMany({
    where: {
      isArchived: false,
      stage: { category: 'OPEN' },
      lastOutboundAt: { lt: cutoff },
      OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: db.client.fields.lastOutboundAt } }],
    },
    select: { id: true, assignedUserId: true, lastOutboundAt: true },
    take: 500,
  });

  let created = 0;
  for (const client of candidates) {
    const result = await createSystemFollowUp({
      clientId: client.id,
      reasonKey: FOLLOW_UP_REASONS.STOPPED_RESPONDING,
      dueAt: new Date(),
      priority: 'NORMAL',
      assignedUserId: client.assignedUserId,
      // One per client per calendar day at most.
      dedupeKey: `no-response:${client.id}:${new Date().toISOString().slice(0, 10)}`,
      createdBySystem: 'workflow:no_response_sweep',
    });
    if (result?.created) created += 1;
  }

  return created;
}

/** Follow-ups due today, for the dashboard. */
export async function todaysFollowUps(assignedUserId?: string | null, take = 10) {
  const now = new Date();
  return db.followUp.findMany({
    where: {
      status: 'SCHEDULED',
      dueAt: { lte: endOfDay(now) },
      ...(assignedUserId !== undefined ? { assignedUserId } : {}),
    },
    orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
    take,
    include: followUpInclude,
  });
}

/** Convenience for workflow rules: "in N days at 10am, during business hours". */
export function scheduleIn(days: number, hourOfDay = 10): Date {
  const d = addDays(new Date(), days);
  d.setHours(hourOfDay, 0, 0, 0);
  return d;
}
