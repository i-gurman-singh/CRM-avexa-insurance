import '@/lib/server-guard';
import { z } from 'zod';
import { db } from '@/lib/db';
import { ConflictError, NotFoundError } from '@/lib/errors';
import type { Prisma } from '@/lib/types';
import { toNumber } from '@/lib/utils';
import { ACTIVITY_TYPES, recordActivity } from '@/core/activity/service';
import { recordAudit } from '@/core/audit/service';
import { actorUserId, isSystemActor, requirePermission, type AnyActor } from '@/core/context';
import { moveClientToStage } from '@/core/pipeline/service';
import { getSetting } from '@/core/settings/service';

/**
 * Policies.
 *
 * Binding is the most consequential action in the CRM and is deliberately the
 * narrowest: it requires the `policies.bind` permission (administrators and
 * brokers only), it cannot be performed by automation at all, and it refuses
 * to run while required documents are outstanding.
 */

const decimal = z
  .union([z.string(), z.number()])
  .optional()
  .nullable()
  .transform((v) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });

const optionalDate = z
  .union([z.string(), z.date()])
  .optional()
  .nullable()
  .transform((v) => (v ? new Date(v) : null));

export const policySchema = z.object({
  quoteId: z.string().optional().nullable(),
  insuranceCompanyId: z.string().min(1, 'Choose an insurance company'),
  policyNumber: z.string().trim().max(100).optional().nullable(),
  productKey: z.string().default('auto'),
  effectiveDate: optionalDate,
  expiryDate: optionalDate,
  renewalDate: optionalDate,
  monthlyPremium: decimal,
  annualPremium: decimal,
  commissionRate: decimal,
  commissionAmount: decimal,
  paymentMethod: z.string().trim().max(50).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  customFields: z.record(z.string(), z.unknown()).default({}),
});

export const policyInclude = {
  insuranceCompany: true,
  quote: { include: { insuranceCompany: true } },
} satisfies Prisma.PolicyInclude;

export async function listPolicies(clientId: string) {
  return db.policy.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' }, include: policyInclude });
}

export async function getPolicy(id: string) {
  return db.policy.findUnique({ where: { id }, include: { ...policyInclude, client: true } });
}

export async function createPolicy(actor: AnyActor, clientId: string, rawInput: unknown) {
  requirePermission(actor, 'policies.create');
  const input = policySchema.parse(rawInput);

  const policy = await db.policy.create({
    data: {
      clientId,
      quoteId: input.quoteId ?? null,
      insuranceCompanyId: input.insuranceCompanyId,
      policyNumber: input.policyNumber ?? null,
      productKey: input.productKey,
      status: 'DRAFT',
      effectiveDate: input.effectiveDate,
      expiryDate: input.expiryDate,
      renewalDate: input.renewalDate ?? input.expiryDate,
      monthlyPremium: input.monthlyPremium,
      annualPremium: input.annualPremium,
      commissionRate: input.commissionRate,
      commissionAmount: input.commissionAmount,
      paymentMethod: input.paymentMethod ?? null,
      notes: input.notes ?? null,
      customFields: input.customFields as object,
    },
    include: policyInclude,
  });

  await recordActivity({
    clientId,
    type: ACTIVITY_TYPES.POLICY_CREATED,
    title: `Policy started — ${policy.insuranceCompany.name}`,
    actor,
    entityType: 'Policy',
    entityId: policy.id,
  });
  await recordAudit({ actor, action: 'policy.create', entityType: 'Policy', entityId: policy.id, metadata: { clientId } });
  return policy;
}

export async function updatePolicy(actor: AnyActor, policyId: string, rawInput: unknown) {
  requirePermission(actor, 'policies.update');
  const input = policySchema.partial().parse(rawInput);

  const updated = await db.policy.update({
    where: { id: policyId },
    data: { ...input, customFields: input.customFields ? (input.customFields as object) : undefined },
    include: policyInclude,
  });

  await recordAudit({ actor, action: 'policy.update', entityType: 'Policy', entityId: policyId });
  return updated;
}

export interface BindPolicyOptions {
  /** Bypass the outstanding-documents check, with a recorded reason. */
  overrideMissingDocuments?: boolean;
  overrideReason?: string;
}

/**
 * Bind a policy — the regulated action.
 *
 * Refuses to run for a system/automation actor under any circumstances. This
 * is enforced here, in the domain layer, rather than only in the UI, so a
 * future API client or workflow rule cannot route around it.
 */
export async function bindPolicy(
  actor: AnyActor,
  policyId: string,
  opts: BindPolicyOptions = {},
) {
  if (isSystemActor(actor)) {
    throw new ConflictError('Binding a policy requires a licensed user. Automation cannot bind.');
  }
  requirePermission(actor, 'policies.bind');

  const policy = await db.policy.findUnique({
    where: { id: policyId },
    include: { client: true, insuranceCompany: true },
  });
  if (!policy) throw new NotFoundError('Policy');
  if (policy.status === 'ACTIVE') throw new ConflictError('This policy is already active');

  const outstanding = await db.documentChecklistItem.findMany({
    where: {
      clientId: policy.clientId,
      required: true,
      status: { in: ['NOT_REQUESTED', 'REQUESTED'] },
    },
    include: { documentType: true },
  });

  if (outstanding.length && !opts.overrideMissingDocuments) {
    throw new ConflictError(
      `Still waiting on ${outstanding.length} required document${outstanding.length === 1 ? '' : 's'}`,
      { missing: outstanding.map((o) => o.documentType.name) },
    );
  }

  const bound = await db.policy.update({
    where: { id: policyId },
    data: {
      status: 'ACTIVE',
      boundAt: new Date(),
      boundByUserId: actorUserId(actor),
    },
    include: policyInclude,
  });

  await recordActivity({
    clientId: policy.clientId,
    type: ACTIVITY_TYPES.POLICY_BOUND,
    title: `Policy bound — ${policy.insuranceCompany.name}`,
    body: bound.policyNumber ? `Policy #${bound.policyNumber}` : undefined,
    metadata: {
      overrodeMissingDocuments: Boolean(opts.overrideMissingDocuments && outstanding.length),
      overrideReason: opts.overrideReason,
      missingDocuments: outstanding.map((o) => o.documentType.name),
    },
    actor,
    entityType: 'Policy',
    entityId: policyId,
  });

  await recordAudit({
    actor,
    action: 'policy.bind',
    entityType: 'Policy',
    entityId: policyId,
    metadata: {
      clientId: policy.clientId,
      company: policy.insuranceCompany.name,
      overrodeMissingDocuments: Boolean(opts.overrideMissingDocuments && outstanding.length),
      overrideReason: opts.overrideReason,
    },
  });

  // Move the client to the completed stage, if one is configured.
  await moveClientToStage(actor, {
    clientId: policy.clientId,
    toStageKey: 'policy_completed',
    reason: 'Policy bound',
    changedBy: 'system',
  }).catch(() => {
    // A missing stage must not undo a successful bind.
  });

  // Schedule the renewal reminder.
  if (bound.renewalDate) {
    const noticeDays = await getSetting('followups.renewalNoticeDays');
    const dueAt = new Date(bound.renewalDate.getTime() - noticeDays * 86_400_000);
    if (dueAt.getTime() > Date.now()) {
      await db.followUp.upsert({
        where: { dedupeKey: `renewal:${policyId}` },
        create: {
          clientId: policy.clientId,
          reasonKey: 'renewal_approaching',
          reason: `Renewal for policy ${bound.policyNumber ?? ''} on ${bound.renewalDate.toDateString()}`,
          dueAt,
          priority: 'NORMAL',
          assignedUserId: policy.client.assignedUserId,
          createdBySystem: 'workflow:renewal',
          dedupeKey: `renewal:${policyId}`,
        },
        update: { dueAt },
      });
    }
  }

  return bound;
}

export async function cancelPolicy(actor: AnyActor, policyId: string, reason: string) {
  requirePermission(actor, 'policies.update');
  const policy = await db.policy.update({
    where: { id: policyId },
    data: { status: 'CANCELLED', notes: reason },
    include: policyInclude,
  });
  await recordActivity({
    clientId: policy.clientId,
    type: 'policy.cancelled',
    title: 'Policy cancelled',
    body: reason,
    actor,
    entityType: 'Policy',
    entityId: policyId,
  });
  await recordAudit({ actor, action: 'policy.cancel', entityType: 'Policy', entityId: policyId, metadata: { reason } });
  return policy;
}

/** Policies renewing inside the notice window — powers the renewals view. */
export async function findUpcomingRenewals(withinDays: number) {
  const cutoff = new Date(Date.now() + withinDays * 86_400_000);
  return db.policy.findMany({
    where: { status: 'ACTIVE', renewalDate: { lte: cutoff, gte: new Date() } },
    orderBy: { renewalDate: 'asc' },
    include: { ...policyInclude, client: { select: { id: true, displayName: true, phone: true } } },
  });
}

/** Total written premium and commission over a period. */
export async function premiumTotals(from: Date, to: Date) {
  const policies = await db.policy.findMany({
    where: { status: 'ACTIVE', boundAt: { gte: from, lte: to } },
    select: { annualPremium: true, commissionAmount: true },
  });

  return policies.reduce(
    (acc, p) => ({
      annualPremium: acc.annualPremium + (toNumber(p.annualPremium) ?? 0),
      commission: acc.commission + (toNumber(p.commissionAmount) ?? 0),
      count: acc.count + 1,
    }),
    { annualPremium: 0, commission: 0, count: 0 },
  );
}
