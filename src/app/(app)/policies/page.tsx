import Link from 'next/link';
import { ShieldIcon } from 'lucide-react';
import { db } from '@/lib/db';
import { can } from '@/lib/rbac';
import { formatCurrency, toNumber } from '@/lib/utils';
import { formatDate } from '@/lib/dates';
import { requireAuth } from '@/core/auth/session';
import { findUpcomingRenewals, premiumTotals } from '@/core/policies/service';
import { getSetting } from '@/core/settings/service';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@/ui/components/primitives';
import { StatCard } from '@/ui/components/stat-card';

export const metadata = { title: 'Policies' };
export const dynamic = 'force-dynamic';

export default async function PoliciesPage() {
  const user = await requireAuth();
  const canSeeRevenue = can(
    { role: user.role, permissionOverrides: user.permissionOverrides },
    'analytics.viewRevenue',
  );

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const renewalNoticeDays = await getSetting('followups.renewalNoticeDays');

  const [policies, renewals, totals, activeCount] = await Promise.all([
    db.policy.findMany({
      orderBy: [{ status: 'asc' }, { boundAt: 'desc' }],
      take: 200,
      include: {
        insuranceCompany: true,
        client: { select: { id: true, displayName: true } },
      },
    }),
    findUpcomingRenewals(renewalNoticeDays),
    premiumTotals(monthStart, new Date()),
    db.policy.count({ where: { status: 'ACTIVE' } }),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader title="Policies" description="Bound business and upcoming renewals." />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Active policies" value={activeCount} tone="success" />
        <StatCard label="Bound this month" value={totals.count} tone="info" />
        {canSeeRevenue ? (
          <>
            <StatCard
              label="Premium this month"
              value={formatCurrency(totals.annualPremium, 'CAD', { compact: true })}
              tone="neutral"
            />
            <StatCard
              label="Commission this month"
              value={formatCurrency(totals.commission, 'CAD', { compact: true })}
              tone="neutral"
            />
          </>
        ) : null}
        <StatCard
          label={`Renewing in ${renewalNoticeDays} days`}
          value={renewals.length}
          href="/follow-ups"
          tone={renewals.length > 0 ? 'warning' : 'neutral'}
        />
      </div>

      {renewals.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Upcoming renewals</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Client</TH>
                  <TH>Company</TH>
                  <TH>Policy</TH>
                  <TH>Renews</TH>
                </TR>
              </THead>
              <TBody>
                {renewals.map((policy) => (
                  <TR key={policy.id}>
                    <TD>
                      <Link href={`/clients/${policy.clientId}`} className="text-sm hover:underline">
                        {policy.client.displayName}
                      </Link>
                    </TD>
                    <TD className="text-sm">{policy.insuranceCompany.name}</TD>
                    <TD className="font-mono text-xs">{policy.policyNumber ?? '—'}</TD>
                    <TD className="text-sm">{formatDate(policy.renewalDate)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>All policies</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {policies.length === 0 ? (
            <EmptyState
              icon={<ShieldIcon className="size-7" />}
              title="No policies yet"
              description="Policies appear here once a broker binds one from a selected quote."
            />
          ) : (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Client</TH>
                  <TH>Company</TH>
                  <TH>Policy number</TH>
                  <TH>Status</TH>
                  <TH className="hidden sm:table-cell">Effective</TH>
                  {canSeeRevenue ? <TH className="text-right">Premium</TH> : null}
                </TR>
              </THead>
              <TBody>
                {policies.map((policy) => (
                  <TR key={policy.id}>
                    <TD>
                      <Link href={`/clients/${policy.clientId}?tab=quotes`} className="text-sm hover:underline">
                        {policy.client.displayName}
                      </Link>
                    </TD>
                    <TD className="text-sm">{policy.insuranceCompany.name}</TD>
                    <TD className="font-mono text-xs">{policy.policyNumber ?? '—'}</TD>
                    <TD>
                      <Badge
                        tone={
                          policy.status === 'ACTIVE'
                            ? 'success'
                            : policy.status === 'CANCELLED' || policy.status === 'LAPSED'
                              ? 'critical'
                              : 'neutral'
                        }
                      >
                        {policy.status.toLowerCase().replace(/_/g, ' ')}
                      </Badge>
                    </TD>
                    <TD className="hidden sm:table-cell text-xs text-muted-foreground">
                      {formatDate(policy.effectiveDate)}
                    </TD>
                    {canSeeRevenue ? (
                      <TD className="text-right text-sm tabular-nums">
                        {formatCurrency(toNumber(policy.annualPremium))}
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
