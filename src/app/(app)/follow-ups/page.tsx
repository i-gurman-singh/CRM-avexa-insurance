import Link from 'next/link';
import { ClockIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { requireAuth } from '@/core/auth/session';
import { followUpCounts, listFollowUps, type FollowUpBucket } from '@/core/followups/service';
import { Card, CardContent, EmptyState, PageHeader } from '@/ui/components/primitives';
import { FollowUpList } from './follow-up-list';

export const metadata = { title: 'Follow-ups' };
export const dynamic = 'force-dynamic';

const BUCKETS: Array<{ key: FollowUpBucket; label: string }> = [
  { key: 'today', label: 'Due today' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
];

/**
 * Follow-up queue.
 *
 * Follow-ups are the highest-leverage screen in the CRM: most lost business in
 * a brokerage is a quote nobody chased. Overdue is deliberately loud.
 */
export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{ bucket?: string; scope?: string }>;
}) {
  const user = await requireAuth();
  const { bucket: rawBucket, scope } = await searchParams;

  const bucket = (BUCKETS.find((b) => b.key === rawBucket)?.key ?? 'today') as FollowUpBucket;
  const assignedUserId = scope === 'all' ? undefined : user.id;

  const [{ items }, counts] = await Promise.all([
    listFollowUps({ bucket, assignedUserId, take: 200 }),
    followUpCounts(assignedUserId),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Follow-ups"
        description={
          counts.overdue > 0
            ? `${counts.overdue} overdue — these are the ones that lose business`
            : `${counts.today} due today, ${counts.upcoming} scheduled`
        }
        actions={
          <div className="flex rounded-md border border-border p-0.5 text-xs">
            <Link
              href={`/follow-ups?bucket=${bucket}`}
              className={cn(
                'rounded px-2.5 py-1',
                scope !== 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
              )}
            >
              Mine
            </Link>
            <Link
              href={`/follow-ups?bucket=${bucket}&scope=all`}
              className={cn(
                'rounded px-2.5 py-1',
                scope === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
              )}
            >
              Everyone
            </Link>
          </div>
        }
      />

      <nav className="flex flex-wrap gap-1.5" aria-label="Follow-up filters">
        {BUCKETS.map((b) => {
          const count =
            b.key === 'today' ? counts.today : b.key === 'overdue' ? counts.overdue : b.key === 'upcoming' ? counts.upcoming : 0;
          return (
            <Link
              key={b.key}
              href={`/follow-ups?bucket=${b.key}${scope === 'all' ? '&scope=all' : ''}`}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
                b.key === bucket
                  ? 'border-primary bg-primary text-primary-foreground'
                  : b.key === 'overdue' && count > 0
                    ? 'border-critical bg-critical-subtle text-critical'
                    : 'border-border bg-surface text-muted-foreground hover:bg-accent',
              )}
            >
              {b.label}
              {count > 0 ? (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[10px] tabular-nums',
                    b.key === bucket ? 'bg-white/20' : 'bg-surface-muted',
                  )}
                >
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <EmptyState
              icon={<ClockIcon className="size-7" />}
              title="Nothing to chase"
              description="No follow-ups in this view."
            />
          ) : (
            <FollowUpList
              followUps={items.map((f) => ({
                id: f.id,
                clientId: f.clientId,
                clientName: f.client.displayName,
                clientPhone: f.client.phone,
                unreadCount: f.client.unreadCount,
                stageName: f.client.stage.name,
                stageColor: f.client.stage.color,
                reason: f.reason ?? f.reasonKey.replace(/_/g, ' '),
                reasonKey: f.reasonKey,
                status: f.status,
                priority: f.priority,
                dueAt: f.dueAt.toISOString(),
                notes: f.notes,
                assignedName: f.assignedUser?.name ?? null,
                createdBySystem: f.createdBySystem,
              }))}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
