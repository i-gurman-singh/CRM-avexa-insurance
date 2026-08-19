import '@/lib/server-guard';
import { z } from 'zod';
import { db } from '@/lib/db';
import { ConflictError, NotFoundError } from '@/lib/errors';
import type { Prisma } from '@/lib/types';
import { toNumber } from '@/lib/utils';
import { ACTIVITY_TYPES, recordActivity } from '@/core/activity/service';
import { recordAudit } from '@/core/audit/service';
import { actorUserId, requirePermission, type AnyActor } from '@/core/context';
import { getQuoteStatusByKey } from '@/core/settings/lookups';

/**
 * Quote management.
 *
 * A client can be quoted by several companies at once; the CRM stores each as
 * its own row so staff can compare side by side and record which one the
 * client actually chose. Selecting a quote is a human-only action — see
 * HUMAN_ONLY_ACTIONS in src/lib/rbac.ts.
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

const optionalString = z
  .string()
  .trim()
  .max(500)
  .optional()
  .nullable()
  .transform((v) => (v === '' ? null : (v ?? null)));

export const quoteSchema = z.object({
  insuranceCompanyId: z.string().min(1, 'Choose an insurance company'),
  statusId: z.string().optional(),
  productKey: z.string().default('auto'),
  quoteDate: z
    .union([z.string(), z.date()])
    .optional()
    .transform((v) => (v ? new Date(v) : new Date())),
  expiresAt: z
    .union([z.string(), z.date()])
    .optional()
    .nullable()
    .transform((v) => (v ? new Date(v) : null)),

  monthlyPremium: decimal,
  annualPremium: decimal,
  currency: z.string().default('CAD'),

  coverageType: optionalString,
  liabilityLimit: decimal,
  collisionDeductible: decimal,
  comprehensiveDeductible: decimal,
  telematics: z.boolean().default(false),
  bundleType: optionalString,
  bundleDiscount: decimal,

  discounts: z
    .array(z.object({ name: z.string(), amount: z.number().optional() }))
    .default([]),
  coverageDetails: z.record(z.string(), z.unknown()).default({}),
  customFields: z.record(z.string(), z.unknown()).default({}),
  notes: optionalString,
});

export type QuoteInput = z.input<typeof quoteSchema>;

export const quoteInclude = {
  insuranceCompany: true,
  status: true,
  createdByUser: { select: { id: true, name: true } },
} satisfies Prisma.QuoteInclude;

export async function listQuotes(clientId: string) {
  return db.quote.findMany({
    where: { clientId },
    orderBy: [{ isSelected: 'desc' }, { quoteDate: 'desc' }],
    include: quoteInclude,
  });
}

export async function getQuote(id: string) {
  return db.quote.findUnique({ where: { id }, include: { ...quoteInclude, client: true } });
}

/**
 * If only one of monthly/annual is supplied, derive the other. Brokers quote
 * in whichever unit the company gives them, but analytics needs both.
 */
function reconcilePremiums(monthly: number | null, annual: number | null) {
  if (monthly !== null && annual === null) return { monthly, annual: Number((monthly * 12).toFixed(2)) };
  if (annual !== null && monthly === null) return { monthly: Number((annual / 12).toFixed(2)), annual };
  return { monthly, annual };
}

export async function createQuote(actor: AnyActor, clientId: string, rawInput: unknown) {
  requirePermission(actor, 'quotes.create');
  const input = quoteSchema.parse(rawInput);

  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) throw new NotFoundError('Client');

  const status = input.statusId
    ? await db.quoteStatus.findUnique({ where: { id: input.statusId } })
    : ((await getQuoteStatusByKey('draft')) ??
      (await db.quoteStatus.findFirst({ where: { isActive: true }, orderBy: { position: 'asc' } })));
  if (!status) throw new ConflictError('No quote statuses configured. Run the database seed.');

  const premiums = reconcilePremiums(input.monthlyPremium, input.annualPremium);

  const quote = await db.quote.create({
    data: {
      clientId,
      insuranceCompanyId: input.insuranceCompanyId,
      statusId: status.id,
      productKey: input.productKey,
      quoteDate: input.quoteDate,
      expiresAt: input.expiresAt,
      monthlyPremium: premiums.monthly,
      annualPremium: premiums.annual,
      currency: input.currency,
      coverageType: input.coverageType,
      liabilityLimit: input.liabilityLimit,
      collisionDeductible: input.collisionDeductible,
      comprehensiveDeductible: input.comprehensiveDeductible,
      telematics: input.telematics,
      bundleType: input.bundleType,
      bundleDiscount: input.bundleDiscount,
      discounts: input.discounts as object,
      coverageDetails: input.coverageDetails as object,
      customFields: input.customFields as object,
      notes: input.notes,
      createdByUserId: actorUserId(actor),
    },
    include: quoteInclude,
  });

  await recordActivity({
    clientId,
    type: ACTIVITY_TYPES.QUOTE_CREATED,
    title: `Quote created — ${quote.insuranceCompany.name}`,
    body: premiums.monthly ? `$${premiums.monthly.toFixed(2)}/month` : undefined,
    metadata: { company: quote.insuranceCompany.name, monthly: premiums.monthly, annual: premiums.annual },
    actor,
    entityType: 'Quote',
    entityId: quote.id,
  });

  await recordAudit({ actor, action: 'quote.create', entityType: 'Quote', entityId: quote.id, metadata: { clientId } });
  return quote;
}

export async function updateQuote(actor: AnyActor, quoteId: string, rawInput: unknown) {
  requirePermission(actor, 'quotes.update');
  const input = quoteSchema.partial().parse(rawInput);

  const existing = await db.quote.findUnique({ where: { id: quoteId } });
  if (!existing) throw new NotFoundError('Quote');

  const premiums = reconcilePremiums(
    input.monthlyPremium ?? toNumber(existing.monthlyPremium),
    input.annualPremium ?? toNumber(existing.annualPremium),
  );

  const updated = await db.quote.update({
    where: { id: quoteId },
    data: {
      ...input,
      monthlyPremium: premiums.monthly,
      annualPremium: premiums.annual,
      discounts: input.discounts ? (input.discounts as object) : undefined,
      coverageDetails: input.coverageDetails ? (input.coverageDetails as object) : undefined,
      customFields: input.customFields ? (input.customFields as object) : undefined,
    },
    include: quoteInclude,
  });

  await recordActivity({
    clientId: existing.clientId,
    type: ACTIVITY_TYPES.QUOTE_UPDATED,
    title: `Quote updated — ${updated.insuranceCompany.name}`,
    actor,
    entityType: 'Quote',
    entityId: quoteId,
  });
  await recordAudit({ actor, action: 'quote.update', entityType: 'Quote', entityId: quoteId });
  return updated;
}

/** Record that a quote was presented to the client. */
export async function markQuoteSent(actor: AnyActor, quoteId: string) {
  requirePermission(actor, 'quotes.update');

  const providedStatus = await db.quoteStatus.findFirst({ where: { isProvided: true, isActive: true }, orderBy: { position: 'asc' } });

  const quote = await db.quote.update({
    where: { id: quoteId },
    data: { sentToClientAt: new Date(), ...(providedStatus ? { statusId: providedStatus.id } : {}) },
    include: quoteInclude,
  });

  await recordActivity({
    clientId: quote.clientId,
    type: ACTIVITY_TYPES.QUOTE_SENT,
    title: `Quote sent — ${quote.insuranceCompany.name}`,
    body: quote.monthlyPremium ? `$${toNumber(quote.monthlyPremium)?.toFixed(2)}/month` : undefined,
    actor,
    entityType: 'Quote',
    entityId: quoteId,
  });
  await recordAudit({ actor, action: 'quote.send', entityType: 'Quote', entityId: quoteId });
  return quote;
}

/**
 * Mark the quote the client chose. Human-only: automation may suggest it, but
 * a person must confirm, because it is the commitment that leads to binding.
 */
export async function selectQuote(actor: AnyActor, quoteId: string) {
  requirePermission(actor, 'quotes.select');

  const quote = await db.quote.findUnique({ where: { id: quoteId }, include: quoteInclude });
  if (!quote) throw new NotFoundError('Quote');

  const updated = await db.$transaction(async (tx) => {
    await tx.quote.updateMany({
      where: { clientId: quote.clientId, isSelected: true },
      data: { isSelected: false, selectedAt: null },
    });
    return tx.quote.update({
      where: { id: quoteId },
      data: { isSelected: true, selectedAt: new Date() },
      include: quoteInclude,
    });
  });

  await recordActivity({
    clientId: quote.clientId,
    type: ACTIVITY_TYPES.QUOTE_SELECTED,
    title: `Client selected ${quote.insuranceCompany.name}`,
    body: quote.monthlyPremium ? `$${toNumber(quote.monthlyPremium)?.toFixed(2)}/month` : undefined,
    actor,
    entityType: 'Quote',
    entityId: quoteId,
  });
  await recordAudit({ actor, action: 'quote.select', entityType: 'Quote', entityId: quoteId });
  return updated;
}

export async function deleteQuote(actor: AnyActor, quoteId: string) {
  requirePermission(actor, 'quotes.delete');
  const quote = await db.quote.delete({ where: { id: quoteId } });
  await recordAudit({ actor, action: 'quote.delete', entityType: 'Quote', entityId: quoteId });
  return quote;
}

/** Side-by-side comparison payload for the client profile. */
export async function compareQuotes(clientId: string) {
  const quotes = await listQuotes(clientId);
  const monthly = quotes.map((q) => toNumber(q.monthlyPremium)).filter((n): n is number => n !== null);

  return {
    quotes,
    cheapestMonthly: monthly.length ? Math.min(...monthly) : null,
    dearestMonthly: monthly.length ? Math.max(...monthly) : null,
    averageMonthly: monthly.length ? monthly.reduce((a, b) => a + b, 0) / monthly.length : null,
    selected: quotes.find((q) => q.isSelected) ?? null,
  };
}
