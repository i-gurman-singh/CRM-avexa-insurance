import '@/lib/server-guard';
import { z } from 'zod';
import { db, type DbClient } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import type { Prisma, Priority, TaskStatus } from '@/lib/types';
import { addDays, endOfDay, startOfDay } from '@/lib/utils';
import { ACTIVITY_TYPES, recordActivity } from '@/core/activity/service';
import { recordAudit } from '@/core/audit/service';
import { actorUserId, requirePermission, type AnyActor } from '@/core/context';

/**
 * Tasks.
 *
 * Both people and automation create tasks. Automation always passes a
 * `dedupeKey` so a rule that fires repeatedly (e.g. every inbound message)
 * cannot bury staff in duplicates — the unique index on dedupeKey makes that
 * guarantee at the database level rather than relying on careful callers.
 */

export const taskSchema = z.object({
  clientId: z.string().optional().nullable(),
  taskTypeId: z.string().optional().nullable(),
  title: z.string().trim().min(1, 'Give the task a title').max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  dueAt: z
    .union([z.string(), z.date()])
    .optional()
    .nullable()
    .transform((v) => (v ? new Date(v) : null)),
  assignedUserId: z.string().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export type TaskInput = z.input<typeof taskSchema>;

export const taskInclude = {
  client: { select: { id: true, displayName: true, phone: true, stage: { select: { name: true, color: true } } } },
  assignedUser: { select: { id: true, name: true, avatarUrl: true } },
  taskType: true,
} satisfies Prisma.TaskInclude;

export type TaskBucket = 'today' | 'upcoming' | 'overdue' | 'completed' | 'unscheduled' | 'all';

export interface TaskQuery {
  bucket?: TaskBucket;
  assignedUserId?: string | null;
  clientId?: string;
  priority?: Priority;
  status?: TaskStatus;
  take?: number;
  skip?: number;
}

function bucketWhere(bucket: TaskBucket | undefined, now: Date): Prisma.TaskWhereInput {
  switch (bucket) {
    case 'today':
      return { status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: { gte: startOfDay(now), lte: endOfDay(now) } };
    case 'overdue':
      return { status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: { lt: startOfDay(now) } };
    case 'upcoming':
      return { status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: { gt: endOfDay(now) } };
    case 'unscheduled':
      return { status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: null };
    case 'completed':
      return { status: 'COMPLETED' };
    default:
      return {};
  }
}

export async function listTasks(query: TaskQuery = {}) {
  const now = new Date();
  const where: Prisma.TaskWhereInput = {
    ...bucketWhere(query.bucket, now),
    ...(query.assignedUserId !== undefined ? { assignedUserId: query.assignedUserId } : {}),
    ...(query.clientId ? { clientId: query.clientId } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.status ? { status: query.status } : {}),
  };

  const [items, total] = await Promise.all([
    db.task.findMany({
      where,
      orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
      take: query.take ?? 100,
      skip: query.skip ?? 0,
      include: taskInclude,
    }),
    db.task.count({ where }),
  ]);

  return { items, total };
}

/** Counts for the task board tabs, in one round trip. */
export async function taskCounts(assignedUserId?: string | null) {
  const now = new Date();
  const scope = assignedUserId !== undefined ? { assignedUserId } : {};

  const [today, overdue, upcoming, unscheduled, completedToday] = await Promise.all([
    db.task.count({ where: { ...scope, ...bucketWhere('today', now) } }),
    db.task.count({ where: { ...scope, ...bucketWhere('overdue', now) } }),
    db.task.count({ where: { ...scope, ...bucketWhere('upcoming', now) } }),
    db.task.count({ where: { ...scope, ...bucketWhere('unscheduled', now) } }),
    db.task.count({
      where: { ...scope, status: 'COMPLETED', completedAt: { gte: startOfDay(now), lte: endOfDay(now) } },
    }),
  ]);

  return { today, overdue, upcoming, unscheduled, completedToday };
}

export async function createTask(actor: AnyActor, rawInput: unknown) {
  requirePermission(actor, 'tasks.create');
  const input = taskSchema.parse(rawInput);

  // Fill the due date from the task type's default when none was given.
  let dueAt = input.dueAt;
  let priority = input.priority;
  if (input.taskTypeId) {
    const type = await db.taskType.findUnique({ where: { id: input.taskTypeId } });
    if (type) {
      if (!dueAt) dueAt = addDays(new Date(), type.defaultDueInDays);
      if (!input.priority || input.priority === 'NORMAL') priority = type.defaultPriority;
    }
  }

  const task = await db.task.create({
    data: {
      clientId: input.clientId ?? null,
      taskTypeId: input.taskTypeId ?? null,
      title: input.title,
      description: input.description ?? null,
      priority,
      dueAt,
      assignedUserId: input.assignedUserId ?? null,
      notes: input.notes ?? null,
      createdByUserId: actorUserId(actor),
      createdBySystem: 'manual',
    },
    include: taskInclude,
  });

  if (task.clientId) {
    await recordActivity({
      clientId: task.clientId,
      type: ACTIVITY_TYPES.TASK_CREATED,
      title: `Task created: ${task.title}`,
      actor,
      entityType: 'Task',
      entityId: task.id,
    });
  }
  await recordAudit({ actor, action: 'task.create', entityType: 'Task', entityId: task.id });
  return task;
}

export interface SystemTaskInput {
  clientId: string;
  title: string;
  description?: string;
  taskTypeKey?: string;
  priority?: Priority;
  dueAt?: Date;
  assignedUserId?: string | null;
  /** Required — this is what makes automation idempotent. */
  dedupeKey: string;
  createdBySystem: string;
}

/**
 * Create a task on behalf of a workflow rule.
 * Returns null when an identical task already exists.
 */
export async function createSystemTask(
  input: SystemTaskInput,
  client: DbClient = db,
): Promise<{ id: string } | null> {
  const existing = await client.task.findUnique({ where: { dedupeKey: input.dedupeKey } });
  if (existing) return null;

  const taskType = input.taskTypeKey
    ? await client.taskType.findUnique({ where: { key: input.taskTypeKey } })
    : null;

  try {
    const task = await client.task.create({
      data: {
        clientId: input.clientId,
        taskTypeId: taskType?.id ?? null,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? taskType?.defaultPriority ?? 'NORMAL',
        dueAt: input.dueAt ?? addDays(new Date(), taskType?.defaultDueInDays ?? 1),
        assignedUserId: input.assignedUserId ?? null,
        createdBySystem: input.createdBySystem,
        dedupeKey: input.dedupeKey,
      },
    });
    return { id: task.id };
  } catch (e: any) {
    // Concurrent creation lost the race — that's the desired outcome.
    if (e?.code === 'P2002') return null;
    throw e;
  }
}

export async function updateTask(actor: AnyActor, taskId: string, rawInput: unknown) {
  requirePermission(actor, 'tasks.update');
  const input = taskSchema.partial().parse(rawInput);

  const updated = await db.task.update({
    where: { id: taskId },
    data: {
      title: input.title,
      description: input.description,
      priority: input.priority,
      dueAt: input.dueAt,
      assignedUserId: input.assignedUserId,
      notes: input.notes,
      taskTypeId: input.taskTypeId,
    },
    include: taskInclude,
  });

  await recordAudit({ actor, action: 'task.update', entityType: 'Task', entityId: taskId });
  return updated;
}

export async function setTaskStatus(actor: AnyActor, taskId: string, status: TaskStatus) {
  requirePermission(actor, 'tasks.update');

  const existing = await db.task.findUnique({ where: { id: taskId } });
  if (!existing) throw new NotFoundError('Task');

  const task = await db.task.update({
    where: { id: taskId },
    data: {
      status,
      completedAt: status === 'COMPLETED' ? new Date() : null,
      completedByUserId: status === 'COMPLETED' ? actorUserId(actor) : null,
    },
    include: taskInclude,
  });

  if (status === 'COMPLETED' && task.clientId) {
    await recordActivity({
      clientId: task.clientId,
      type: ACTIVITY_TYPES.TASK_COMPLETED,
      title: `Task completed: ${task.title}`,
      actor,
      entityType: 'Task',
      entityId: taskId,
    });
  }

  await recordAudit({ actor, action: 'task.setStatus', entityType: 'Task', entityId: taskId, metadata: { status } });
  return task;
}

export async function assignTask(actor: AnyActor, taskId: string, userId: string | null) {
  requirePermission(actor, 'tasks.assign');
  const task = await db.task.update({ where: { id: taskId }, data: { assignedUserId: userId }, include: taskInclude });
  await recordAudit({ actor, action: 'task.assign', entityType: 'Task', entityId: taskId, metadata: { userId } });
  return task;
}

export async function deleteTask(actor: AnyActor, taskId: string) {
  requirePermission(actor, 'tasks.delete');
  const task = await db.task.delete({ where: { id: taskId } });
  await recordAudit({ actor, action: 'task.delete', entityType: 'Task', entityId: taskId });
  return task;
}
