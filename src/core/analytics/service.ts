import '@/lib/server-guard';
import { db } from '@/lib/db';
import { calculateAge, percentage, safeDivide, toNumber } from '@/lib/utils';

/**
 * Analytics.
 *
 * Everything here is computed from the operational tables with plain queries —
 * no separate warehouse, no nightly ETL. At brokerage volume that stays fast
 * and, more importantly, it means the numbers on the dashboard are the same
 * numbers in the database, with no staleness to explain to anyone.
 *
 * If volume ever makes this slow, the fix is a materialised view behind these
 * same function signatures; no caller changes.
 */

export interface DateRange {
  from: Date;
  to: Date;
}

export function defaultRange(days = 30): DateRange {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export async function leadMetrics(range: DateRange) {
  const [total, byDay, bySource, quotesRequested, quotesProvided] = await Promise.all([
    db.client.count({ where: { createdAt: { gte: range.from, lte: range.to } } }),

    db.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
      FROM "Client"
      WHERE "createdAt" BETWEEN ${range.from} AND ${range.to}
      GROUP BY 1
      ORDER BY 1 ASC
    `,

    db.client.groupBy({
      by: ['leadSourceId'],
      where: { createdAt: { gte: range.from, lte: range.to } },
      _count: { _all: true },
    }),

    db.client.count({
      where: {
        createdAt: { gte: range.from, lte: range.to },
        stageHistory: { some: { toStage: { key: { in: ['quote_requested', 'quoting'] } } } },
      },
    }),

    db.quote.count({
      where: { quoteDate: { gte: range.from, lte: range.to }, status: { isProvided: true } },
    }),
  ]);

  const sources = await db.leadSource.findMany();
  const sourceById = new Map(sources.map((s) => [s.id, s.name]));

  const boundCount = await db.policy.count({
    where: { status: 'ACTIVE', boundAt: { gte: range.from, lte: range.to } },
  });

  return {
    total,
    perDay: byDay.map((r) => ({ date: r.day.toISOString().slice(0, 10), count: Number(r.count) })),
    bySource: bySource
      .map((s) => ({
        source: s.leadSourceId ? (sourceById.get(s.leadSourceId) ?? 'Unknown') : 'Unknown',
        count: s._count._all,
      }))
      .sort((a, b) => b.count - a.count),
    quotesRequested,
    quotesProvided,
    policiesBound: boundCount,
    quoteConversionRate: percentage(quotesProvided, Math.max(quotesRequested, 1)),
    leadToPolicyRate: percentage(boundCount, Math.max(total, 1)),
  };
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export async function salesMetrics(range: DateRange) {
  const policies = await db.policy.findMany({
    where: { status: 'ACTIVE', boundAt: { gte: range.from, lte: range.to } },
    select: {
      annualPremium: true,
      monthlyPremium: true,
      commissionAmount: true,
      boundAt: true,
      clientId: true,
      client: { select: { createdAt: true } },
    },
  });

  const quotes = await db.quote.findMany({
    where: { quoteDate: { gte: range.from, lte: range.to } },
    select: { annualPremium: true, monthlyPremium: true },
  });

  const annuals = policies.map((p) => toNumber(p.annualPremium) ?? 0).filter((n) => n > 0);
  const quoteAnnuals = quotes.map((q) => toNumber(q.annualPremium) ?? 0).filter((n) => n > 0);

  // Time from first contact to bound policy — the number brokers actually care
  // about when deciding whether the process is working.
  const leadTimes = policies
    .filter((p) => p.boundAt && p.client?.createdAt)
    .map((p) => (p.boundAt!.getTime() - p.client!.createdAt.getTime()) / 86_400_000)
    .filter((d) => d >= 0);

  const totalQuotes = quotes.length;

  return {
    policiesBound: policies.length,
    totalAnnualPremium: annuals.reduce((a, b) => a + b, 0),
    totalCommission: policies.reduce((sum, p) => sum + (toNumber(p.commissionAmount) ?? 0), 0),
    averagePremium: annuals.length ? annuals.reduce((a, b) => a + b, 0) / annuals.length : 0,
    averageQuote: quoteAnnuals.length ? quoteAnnuals.reduce((a, b) => a + b, 0) / quoteAnnuals.length : 0,
    quotesCreated: totalQuotes,
    conversionRate: percentage(policies.length, Math.max(totalQuotes, 1)),
    averageDaysToPolicy: leadTimes.length
      ? Number((leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length).toFixed(1))
      : null,
    medianDaysToPolicy: leadTimes.length ? Number(median(leadTimes).toFixed(1)) : null,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// ---------------------------------------------------------------------------
// Age analytics — configurable buckets
// ---------------------------------------------------------------------------

export async function ageMetrics(range: DateRange) {
  const groups = await db.ageGroup.findMany({ where: { isActive: true }, orderBy: { position: 'asc' } });

  const clients = await db.client.findMany({
    where: { createdAt: { gte: range.from, lte: range.to }, dateOfBirth: { not: null } },
    select: {
      id: true,
      dateOfBirth: true,
      quotes: { select: { id: true } },
      policies: { where: { status: 'ACTIVE' }, select: { id: true, annualPremium: true } },
    },
  });

  const buckets = groups.map((g) => ({
    id: g.id,
    name: g.name,
    minAge: g.minAge,
    maxAge: g.maxAge,
    leads: 0,
    quotes: 0,
    conversions: 0,
    premiumTotal: 0,
  }));

  let unbucketed = 0;

  for (const client of clients) {
    const age = calculateAge(client.dateOfBirth);
    if (age === null) continue;

    const bucket = buckets.find((b) => age >= b.minAge && (b.maxAge === null || age <= b.maxAge));
    if (!bucket) {
      unbucketed += 1;
      continue;
    }

    bucket.leads += 1;
    bucket.quotes += client.quotes.length;
    bucket.conversions += client.policies.length ? 1 : 0;
    bucket.premiumTotal += client.policies.reduce((s, p) => s + (toNumber(p.annualPremium) ?? 0), 0);
  }

  const withRates = buckets.map((b) => ({
    ...b,
    conversionRate: percentage(b.conversions, Math.max(b.leads, 1)),
    averagePremium: safeDivide(b.premiumTotal, b.conversions),
  }));

  const best = [...withRates]
    .filter((b) => b.leads >= 3) // ignore buckets too small to mean anything
    .sort((a, b) => b.conversionRate - a.conversionRate)[0];

  return {
    buckets: withRates,
    unbucketed,
    clientsWithoutDob: await db.client.count({
      where: { createdAt: { gte: range.from, lte: range.to }, dateOfBirth: null },
    }),
    bestConverting: best ?? null,
  };
}

// ---------------------------------------------------------------------------
// Insurance company analytics
// ---------------------------------------------------------------------------

export async function companyMetrics(range: DateRange) {
  const companies = await db.insuranceCompany.findMany({ orderBy: { name: 'asc' } });

  const [quotes, policies] = await Promise.all([
    db.quote.findMany({
      where: { quoteDate: { gte: range.from, lte: range.to } },
      select: { insuranceCompanyId: true, annualPremium: true, isSelected: true },
    }),
    db.policy.findMany({
      where: { status: 'ACTIVE', boundAt: { gte: range.from, lte: range.to } },
      select: { insuranceCompanyId: true, annualPremium: true },
    }),
  ]);

  const rows = companies.map((company) => {
    const companyQuotes = quotes.filter((q) => q.insuranceCompanyId === company.id);
    const companyPolicies = policies.filter((p) => p.insuranceCompanyId === company.id);
    const premiums = companyQuotes.map((q) => toNumber(q.annualPremium) ?? 0).filter((n) => n > 0);

    return {
      id: company.id,
      name: company.name,
      quotes: companyQuotes.length,
      selected: companyQuotes.filter((q) => q.isSelected).length,
      bound: companyPolicies.length,
      conversionRate: percentage(companyPolicies.length, Math.max(companyQuotes.length, 1)),
      averageQuotedPremium: premiums.length ? premiums.reduce((a, b) => a + b, 0) / premiums.length : 0,
      boundPremium: companyPolicies.reduce((s, p) => s + (toNumber(p.annualPremium) ?? 0), 0),
    };
  });

  const active = rows.filter((r) => r.quotes > 0 || r.bound > 0);

  return {
    companies: active.sort((a, b) => b.bound - a.bound || b.quotes - a.quotes),
    mostSelected: [...active].sort((a, b) => b.selected - a.selected)[0] ?? null,
    bestConverting:
      [...active].filter((c) => c.quotes >= 3).sort((a, b) => b.conversionRate - a.conversionRate)[0] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Lead source conversion
// ---------------------------------------------------------------------------

export async function sourceMetrics(range: DateRange) {
  const sources = await db.leadSource.findMany({ orderBy: { position: 'asc' } });

  const clients = await db.client.findMany({
    where: { createdAt: { gte: range.from, lte: range.to } },
    select: {
      leadSourceId: true,
      quotes: { select: { id: true } },
      policies: { where: { status: 'ACTIVE' }, select: { id: true, annualPremium: true } },
    },
  });

  const rows = sources.map((source) => {
    const own = clients.filter((c) => c.leadSourceId === source.id);
    const converted = own.filter((c) => c.policies.length > 0);
    return {
      id: source.id,
      name: source.name,
      leads: own.length,
      quoted: own.filter((c) => c.quotes.length > 0).length,
      converted: converted.length,
      conversionRate: percentage(converted.length, Math.max(own.length, 1)),
      premium: converted.reduce(
        (s, c) => s + c.policies.reduce((ps, p) => ps + (toNumber(p.annualPremium) ?? 0), 0),
        0,
      ),
    };
  });

  const unknown = clients.filter((c) => !c.leadSourceId);
  if (unknown.length) {
    const converted = unknown.filter((c) => c.policies.length > 0);
    rows.push({
      id: 'unknown',
      name: 'Not recorded',
      leads: unknown.length,
      quoted: unknown.filter((c) => c.quotes.length > 0).length,
      converted: converted.length,
      conversionRate: percentage(converted.length, Math.max(unknown.length, 1)),
      premium: 0,
    });
  }

  return rows.filter((r) => r.leads > 0).sort((a, b) => b.leads - a.leads);
}

// ---------------------------------------------------------------------------
// Lost business
// ---------------------------------------------------------------------------

export async function lostBusinessMetrics(range: DateRange) {
  const reasons = await db.lostReason.findMany({ orderBy: { position: 'asc' } });

  const lost = await db.client.findMany({
    where: {
      stage: { category: 'LOST' },
      updatedAt: { gte: range.from, lte: range.to },
    },
    select: { lostReasonId: true },
  });

  const byReason = reasons.map((reason) => ({
    id: reason.id,
    name: reason.name,
    count: lost.filter((c) => c.lostReasonId === reason.id).length,
  }));

  const unrecorded = lost.filter((c) => !c.lostReasonId).length;
  if (unrecorded) byReason.push({ id: 'unknown', name: 'Reason not recorded', count: unrecorded });

  const total = lost.length;

  return {
    total,
    byReason: byReason
      .filter((r) => r.count > 0)
      .map((r) => ({ ...r, share: percentage(r.count, Math.max(total, 1)) }))
      .sort((a, b) => b.count - a.count),
  };
}

// ---------------------------------------------------------------------------
// Pipeline funnel
// ---------------------------------------------------------------------------

export async function pipelineMetrics() {
  const stages = await db.pipelineStage.findMany({
    where: { isActive: true },
    orderBy: { position: 'asc' },
  });

  const counts = await db.client.groupBy({
    by: ['stageId'],
    where: { isArchived: false },
    _count: { _all: true },
  });
  const countByStage = new Map(counts.map((c) => [c.stageId, c._count._all]));

  // Average time spent in each stage, from the history table.
  const durations = await db.$queryRaw<Array<{ stageId: string; avgSeconds: number | null }>>`
    SELECT "fromStageId" AS "stageId", AVG("durationSeconds")::float AS "avgSeconds"
    FROM "ClientStageHistory"
    WHERE "fromStageId" IS NOT NULL AND "durationSeconds" IS NOT NULL
    GROUP BY 1
  `;
  const avgByStage = new Map(durations.map((d) => [d.stageId, d.avgSeconds]));

  return stages.map((stage) => ({
    id: stage.id,
    key: stage.key,
    name: stage.name,
    color: stage.color,
    category: stage.category,
    count: countByStage.get(stage.id) ?? 0,
    averageDaysInStage: avgByStage.get(stage.id)
      ? Number(((avgByStage.get(stage.id) ?? 0) / 86_400).toFixed(1))
      : null,
  }));
}

// ---------------------------------------------------------------------------
// Staff performance
// ---------------------------------------------------------------------------

export async function staffMetrics(range: DateRange) {
  const users = await db.user.findMany({ where: { isActive: true }, select: { id: true, name: true } });

  return Promise.all(
    users.map(async (user) => {
      const [assigned, bound, tasksCompleted, followUpsCompleted] = await Promise.all([
        db.client.count({ where: { assignedUserId: user.id, createdAt: { gte: range.from, lte: range.to } } }),
        db.policy.count({
          where: { boundByUserId: user.id, status: 'ACTIVE', boundAt: { gte: range.from, lte: range.to } },
        }),
        db.task.count({
          where: { completedByUserId: user.id, completedAt: { gte: range.from, lte: range.to } },
        }),
        db.followUp.count({
          where: { assignedUserId: user.id, status: 'DONE', completedAt: { gte: range.from, lte: range.to } },
        }),
      ]);

      return {
        id: user.id,
        name: user.name,
        assignedClients: assigned,
        policiesBound: bound,
        tasksCompleted,
        followUpsCompleted,
        conversionRate: percentage(bound, Math.max(assigned, 1)),
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Everything at once, for the analytics page
// ---------------------------------------------------------------------------

export async function fullAnalytics(range: DateRange) {
  const [leads, sales, age, companies, sources, lost, pipeline] = await Promise.all([
    leadMetrics(range),
    salesMetrics(range),
    ageMetrics(range),
    companyMetrics(range),
    sourceMetrics(range),
    lostBusinessMetrics(range),
    pipelineMetrics(),
  ]);

  return { range, leads, sales, age, companies, sources, lost, pipeline };
}
