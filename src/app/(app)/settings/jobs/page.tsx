import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { can } from '@/lib/rbac';
import { timeAgo } from '@/lib/dates';
import { requireAuth } from '@/core/auth/session';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@/ui/components/primitives';
import { StatCard } from '@/ui/components/stat-card';
import { RetryJobButton } from './retry-button';

export const metadata = { title: 'Background jobs' };
export const dynamic = 'force-dynamic';

/**
 * Background job monitor.
 *
 * The point of this screen is that nothing fails silently. Every inbound
 * message, media download, AI analysis and document extraction runs as a job;
 * when one dies it lands here with its error, and can be retried.
 */
export default async function JobsPage() {
  const user = await requireAuth();
  const canRetry = can({ role: user.role, permissionOverrides: user.permissionOverrides }, 'jobs.retry');

  const [queued, running, dead, succeeded24h, jobs] = await Promise.all([
    db.job.count({ where: { status: 'QUEUED' } }),
    db.job.count({ where: { status: 'RUNNING' } }),
    db.job.count({ where: { status: 'DEAD' } }),
    db.job.count({
      where: { status: 'SUCCEEDED', finishedAt: { gte: new Date(Date.now() - 86_400_000) } },
    }),
    db.job.findMany({
      where: { status: { in: ['DEAD', 'RUNNING', 'QUEUED'] } },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: 100,
    }),
  ]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Queued" value={queued} tone={queued > 50 ? 'warning' : 'neutral'} />
        <StatCard label="Running" value={running} />
        <StatCard label="Failed permanently" value={dead} tone={dead > 0 ? 'critical' : 'neutral'} />
        <StatCard label="Completed (24h)" value={succeeded24h} tone="success" />
      </div>

      {env.QUEUE_PROVIDER === 'inline' ? (
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">
              The queue is running in <strong>inline</strong> mode, which processes jobs inside the
              web process and does not persist them. That is fine for local development, but in
              production set{' '}
              <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[11px]">
                QUEUE_PROVIDER=database
              </code>{' '}
              (or <code className="font-mono">sqs</code>) and run{' '}
              <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[11px]">
                npm run worker
              </code>{' '}
              so a slow AI call can never hold up a WhatsApp webhook.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Active and failed jobs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {jobs.length === 0 ? (
            <EmptyState title="Nothing in the queue" description="Every job has completed." />
          ) : (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Job</TH>
                  <TH>Status</TH>
                  <TH className="hidden sm:table-cell">Attempts</TH>
                  <TH className="hidden lg:table-cell">Last error</TH>
                  <TH className="hidden sm:table-cell">Updated</TH>
                  {canRetry ? <TH /> : null}
                </TR>
              </THead>
              <TBody>
                {jobs.map((job) => (
                  <TR key={job.id}>
                    <TD className="font-mono text-xs">{job.type}</TD>
                    <TD>
                      <Badge
                        tone={
                          job.status === 'DEAD'
                            ? 'critical'
                            : job.status === 'RUNNING'
                              ? 'info'
                              : 'neutral'
                        }
                      >
                        {job.status.toLowerCase()}
                      </Badge>
                    </TD>
                    <TD className="hidden sm:table-cell text-xs tabular-nums">
                      {job.attempts}/{job.maxAttempts}
                    </TD>
                    <TD className="hidden lg:table-cell max-w-sm truncate text-xs text-muted-foreground">
                      {job.lastError ?? '—'}
                    </TD>
                    <TD className="hidden sm:table-cell text-xs text-muted-foreground">
                      {timeAgo(job.updatedAt)}
                    </TD>
                    {canRetry ? (
                      <TD className="text-right">
                        {job.status === 'DEAD' ? <RetryJobButton jobId={job.id} /> : null}
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
