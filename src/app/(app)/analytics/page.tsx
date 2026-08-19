import Link from 'next/link';
import { can } from '@/lib/rbac';
import { cn, formatCurrency, formatNumber, formatPercent } from '@/lib/utils';
import { requireAuth } from '@/core/auth/session';
import { defaultRange, fullAnalytics, staffMetrics } from '@/core/analytics/service';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@/ui/components/primitives';
import { StatCard } from '@/ui/components/stat-card';
import { CategoryBarChart, FunnelChart, TrendChart } from '@/ui/components/charts';

export const metadata = { title: 'Analytics' };
export const dynamic = 'force-dynamic';

const RANGES = [
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
  { key: '365', label: '12 months' },
];

/**
 * Analytics.
 *
 * Ordered by the question it answers, not by data source: are leads coming in,
 * are we converting them, who converts best, and why do we lose. Every chart
 * has a table view so nothing depends on reading colour.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const user = await requireAuth();
  const { days: rawDays } = await searchParams;

  const days = RANGES.find((r) => r.key === rawDays)?.key ?? '30';
  const range = defaultRange(Number(days));

  const canSeeRevenue = can(
    { role: user.role, permissionOverrides: user.permissionOverrides },
    'analytics.viewRevenue',
  );

  const [data, staff] = await Promise.all([fullAnalytics(range), staffMetrics(range)]);

  const funnelStages = data.pipeline
    .filter((s) => s.category === 'OPEN' || s.category === 'WON')
    .map((s) => ({ label: s.name, value: s.count, color: s.color }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Analytics"
        description={`${range.from.toLocaleDateString()} – ${range.to.toLocaleDateString()}`}
        actions={
          <div className="flex rounded-md border border-border p-0.5 text-xs">
            {RANGES.map((r) => (
              <Link
                key={r.key}
                href={`/analytics?days=${r.key}`}
                className={cn(
                  'rounded px-2.5 py-1',
                  r.key === days ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                )}
              >
                {r.label}
              </Link>
            ))}
          </div>
        }
      />

      {/* Headline numbers ------------------------------------------------- */}
      <section aria-label="Headline numbers">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="New leads" value={formatNumber(data.leads.total)} tone="info" />
          <StatCard label="Quotes created" value={formatNumber(data.sales.quotesCreated)} />
          <StatCard label="Policies bound" value={formatNumber(data.sales.policiesBound)} tone="success" />
          <StatCard
            label="Quote → policy"
            value={formatPercent(data.sales.conversionRate)}
            tone={data.sales.conversionRate >= 20 ? 'success' : 'neutral'}
          />
          <StatCard
            label="Lead → policy"
            value={formatPercent(data.leads.leadToPolicyRate)}
          />
          <StatCard
            label="Days to policy"
            value={data.sales.averageDaysToPolicy ?? '—'}
            hint={
              data.sales.medianDaysToPolicy !== null
                ? `median ${data.sales.medianDaysToPolicy}`
                : undefined
            }
          />
        </div>
      </section>

      {canSeeRevenue ? (
        <section aria-label="Revenue">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Written premium"
              value={formatCurrency(data.sales.totalAnnualPremium, 'CAD', { compact: true })}
              tone="success"
            />
            <StatCard
              label="Commission"
              value={formatCurrency(data.sales.totalCommission, 'CAD', { compact: true })}
            />
            <StatCard
              label="Average premium"
              value={formatCurrency(data.sales.averagePremium, 'CAD', { compact: true })}
            />
            <StatCard
              label="Average quote"
              value={formatCurrency(data.sales.averageQuote, 'CAD', { compact: true })}
            />
          </div>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <TrendChart
          title="Leads per day"
          description="New clients created, by the day they first came in."
          valueLabel="Leads"
          data={data.leads.perDay.map((d) => ({ label: d.date.slice(5), value: d.count }))}
          colorIndex={0}
        />

        <FunnelChart
          title="Pipeline right now"
          description="How many clients sit in each stage today, and the drop-off between them."
          stages={funnelStages}
        />

        <CategoryBarChart
          title="Leads by source"
          description="Where the business is actually coming from."
          valueLabel="Leads"
          colorIndex={0}
          data={data.leads.bySource.map((s) => ({ label: s.source, value: s.count }))}
        />

        <CategoryBarChart
          title="Conversion by source"
          description="Volume is not value — this is the share of each source that becomes a policy."
          valueLabel="Conversion %"
          secondaryLabel="Leads"
          colorIndex={2}
          highlightMax
          format="percent"
          data={data.sources.map((s) => ({
            label: s.name,
            value: Number(s.conversionRate.toFixed(1)),
            secondary: s.leads,
            secondaryLabel: 'Leads',
          }))}
        />

        <CategoryBarChart
          title="Conversion by age group"
          description="Which age groups actually bind. Groups are configurable in Settings."
          valueLabel="Conversion %"
          secondaryLabel="Leads"
          colorIndex={3}
          highlightMax
          format="percent"
          data={data.age.buckets.map((b) => ({
            label: b.name,
            value: Number(b.conversionRate.toFixed(1)),
            secondary: b.leads,
            secondaryLabel: 'Leads',
          }))}
        />

        <CategoryBarChart
          title="Quotes by company"
          description="How often each insurer is approached."
          valueLabel="Quotes"
          secondaryLabel="Bound"
          colorIndex={1}
          data={data.companies.companies.map((c) => ({
            label: c.name,
            value: c.quotes,
            secondary: c.bound,
            secondaryLabel: 'Bound',
          }))}
        />

        <CategoryBarChart
          title="Why we lose business"
          description="Recorded reasons on clients marked lost in this period."
          valueLabel="Clients"
          colorIndex={1}
          highlightMax
          data={data.lost.byReason.map((r) => ({ label: r.name, value: r.count }))}
        />

        <CategoryBarChart
          title="Average time in stage"
          description="Where files sit longest — usually where the process is leaking."
          valueLabel="Days"
          colorIndex={2}
          highlightMax
          format="days"
          data={data.pipeline
            .filter((s) => s.averageDaysInStage !== null)
            .map((s) => ({ label: s.name, value: s.averageDaysInStage! }))}
        />
      </div>

      {/* Company detail ---------------------------------------------------- */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Insurance companies</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {data.companies.mostSelected
                ? `Clients most often choose ${data.companies.mostSelected.name}.`
                : 'No company has been selected yet in this period.'}
              {data.companies.bestConverting
                ? ` ${data.companies.bestConverting.name} converts best at ${formatPercent(data.companies.bestConverting.conversionRate)}.`
                : ''}
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Company</TH>
                <TH className="text-right">Quotes</TH>
                <TH className="text-right">Selected</TH>
                <TH className="text-right">Bound</TH>
                <TH className="text-right">Conversion</TH>
                <TH className="text-right">Avg quoted premium</TH>
              </TR>
            </THead>
            <TBody>
              {data.companies.companies.length === 0 ? (
                <TR>
                  <TD colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                    No quotes in this period.
                  </TD>
                </TR>
              ) : (
                data.companies.companies.map((c) => (
                  <TR key={c.id}>
                    <TD className="text-sm font-medium">{c.name}</TD>
                    <TD className="text-right tabular-nums">{c.quotes}</TD>
                    <TD className="text-right tabular-nums">{c.selected}</TD>
                    <TD className="text-right tabular-nums">{c.bound}</TD>
                    <TD className="text-right tabular-nums">{formatPercent(c.conversionRate)}</TD>
                    <TD className="text-right tabular-nums">
                      {formatCurrency(c.averageQuotedPremium)}
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      {/* Age detail -------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Age groups</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {data.age.bestConverting
                ? `${data.age.bestConverting.name} converts best at ${formatPercent(data.age.bestConverting.conversionRate)}.`
                : 'Not enough data to call a best-converting group yet.'}
              {data.age.clientsWithoutDob > 0
                ? ` ${data.age.clientsWithoutDob} client${data.age.clientsWithoutDob === 1 ? ' has' : 's have'} no date of birth recorded and are excluded.`
                : ''}
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Group</TH>
                <TH className="text-right">Leads</TH>
                <TH className="text-right">Quotes</TH>
                <TH className="text-right">Bound</TH>
                <TH className="text-right">Conversion</TH>
                {canSeeRevenue ? <TH className="text-right">Avg premium</TH> : null}
              </TR>
            </THead>
            <TBody>
              {data.age.buckets.map((b) => (
                <TR key={b.id}>
                  <TD className="text-sm font-medium">{b.name}</TD>
                  <TD className="text-right tabular-nums">{b.leads}</TD>
                  <TD className="text-right tabular-nums">{b.quotes}</TD>
                  <TD className="text-right tabular-nums">{b.conversions}</TD>
                  <TD className="text-right tabular-nums">{formatPercent(b.conversionRate)}</TD>
                  {canSeeRevenue ? (
                    <TD className="text-right tabular-nums">{formatCurrency(b.averagePremium)}</TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      {/* Staff ------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Person</TH>
                <TH className="text-right">Clients assigned</TH>
                <TH className="text-right">Policies bound</TH>
                <TH className="text-right">Tasks completed</TH>
                <TH className="text-right">Follow-ups completed</TH>
              </TR>
            </THead>
            <TBody>
              {staff.map((s) => (
                <TR key={s.id}>
                  <TD className="text-sm font-medium">{s.name}</TD>
                  <TD className="text-right tabular-nums">{s.assignedClients}</TD>
                  <TD className="text-right tabular-nums">{s.policiesBound}</TD>
                  <TD className="text-right tabular-nums">{s.tasksCompleted}</TD>
                  <TD className="text-right tabular-nums">{s.followUpsCompleted}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
