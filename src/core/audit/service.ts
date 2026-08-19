import '@/lib/server-guard';
import { db, type DbClient } from '@/lib/db';
import { log } from '@/lib/logger';
import { actorUserId, type AnyActor } from '@/core/context';

const logger = log('audit');

/**
 * Audit logging.
 *
 * Records *that* something happened and by whom. Deliberately does not record
 * full before/after values for personal data — a `changedFields` list is
 * enough to investigate an incident without turning the audit table into a
 * second copy of the client database.
 */

export interface AuditInput {
  actor: AnyActor;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

const SENSITIVE_KEYS = new Set([
  'passwordHash',
  'password',
  'licenceNumber',
  'accountNumber',
  'transitNumber',
  'institutionNumber',
  'vin',
  'dateOfBirth',
  'sin',
]);

/** Replace sensitive values with a marker so the audit trail stays safe to read. */
export function redactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_KEYS.has(key)) {
      out[key] = '[redacted]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = redactMetadata(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Write an audit entry. Never throws: losing an audit row must not roll back
 * or fail the business operation it describes. Failures are logged loudly.
 */
export async function recordAudit(input: AuditInput, client: DbClient = db): Promise<void> {
  try {
    const actor = input.actor;
    await client.auditLog.create({
      data: {
        userId: actorUserId(actor),
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: redactMetadata(input.metadata ?? {}) as object,
        ipAddress: 'ipAddress' in actor ? (actor.ipAddress ?? null) : null,
        userAgent: 'userAgent' in actor ? (actor.userAgent ?? null) : null,
      },
    });
  } catch (e) {
    logger.error({ err: e, action: input.action, entityType: input.entityType }, 'Failed to write audit log');
  }
}

/** Compare two objects and return the names of the fields that changed. */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const key of keys) {
    const a = before[key];
    const b = after[key];
    if (b === undefined) continue;
    if (a instanceof Date && b instanceof Date) {
      if (a.getTime() !== b.getTime()) changed.push(key);
      continue;
    }
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) changed.push(key);
  }
  return changed;
}

export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  userId?: string;
  action?: string;
  from?: Date;
  to?: Date;
  take?: number;
  skip?: number;
}

export async function listAuditLogs(query: AuditQuery) {
  const where = {
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.userId ? { userId: query.userId } : {}),
    ...(query.action ? { action: { contains: query.action } } : {}),
    ...(query.from || query.to
      ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
  };

  const [items, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.take ?? 50,
      skip: query.skip ?? 0,
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
    db.auditLog.count({ where }),
  ]);

  return { items, total };
}
