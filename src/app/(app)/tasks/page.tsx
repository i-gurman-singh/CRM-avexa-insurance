import Link from 'next/link';
import { CheckSquareIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { requireAuth } from '@/core/auth/session';
import { listTasks, taskCounts, type TaskBucket } from '@/core/tasks/service';
import { listAssignableUsers } from '@/core/users/service';
import { listTaskTypes } from '@/core/settings/lookups';
import { Card, CardContent, EmptyState, PageHeader } from '@/ui/components/primitives';
import { TaskList, NewTaskButton } from './task-list';

export const metadata = { title: 'Tasks' };
export const dynamic = 'force-dynamic';

const BUCKETS: Array<{ key: TaskBucket; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'unscheduled', label: 'No due date' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
];

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ bucket?: string; scope?: string }>;
}) {
  const user = await requireAuth();
  const { bucket: rawBucket, scope } = await searchParams;

  const bucket = (BUCKETS.find((b) => b.key === rawBucket)?.key ?? 'today') as TaskBucket;
  const assignedUserId = scope === 'all' ? undefined : user.id;

  const [{ items }, counts, users, taskTypes] = await Promise.all([
    listTasks({ bucket, assignedUserId, take: 200 }),
    taskCounts(assignedUserId),
    listAssignableUsers(),
    listTaskTypes(),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tasks"
        description={
          counts.overdue > 0
            ? `${counts.overdue} overdue, ${counts.today} due today`
            : `${counts.today} due today, ${counts.upcoming} upcoming`
        }
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-border p-0.5 text-xs">
              <Link
                href={`/tasks?bucket=${bucket}`}
                className={cn(
                  'rounded px-2.5 py-1',
                  scope !== 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                )}
              >
                Mine
              </Link>
              <Link
                href={`/tasks?bucket=${bucket}&scope=all`}
                className={cn(
                  'rounded px-2.5 py-1',
                  scope === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                )}
              >
                Everyone
              </Link>
            </div>
            <NewTaskButton users={users} taskTypes={taskTypes.map((t) => ({ id: t.id, name: t.name }))} />
          </div>
        }
      />

      <nav className="flex flex-wrap gap-1.5" aria-label="Task filters">
        {BUCKETS.map((b) => {
          const count =
            b.key === 'today'
              ? counts.today
              : b.key === 'overdue'
                ? counts.overdue
                : b.key === 'upcoming'
                  ? counts.upcoming
                  : b.key === 'unscheduled'
                    ? counts.unscheduled
                    : b.key === 'completed'
                      ? counts.completedToday
                      : 0;

          return (
            <Link
              key={b.key}
              href={`/tasks?bucket=${b.key}${scope === 'all' ? '&scope=all' : ''}`}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
                b.key === bucket
                  ? 'border-primary bg-primary text-primary-foreground'
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
              icon={<CheckSquareIcon className="size-7" />}
              title="Nothing here"
              description={
                bucket === 'overdue'
                  ? 'Nothing is overdue — good.'
                  : 'No tasks in this view.'
              }
            />
          ) : (
            <TaskList
              users={users}
              tasks={items.map((t) => ({
                id: t.id,
                title: t.title,
                description: t.description,
                status: t.status,
                priority: t.priority,
                dueAt: t.dueAt?.toISOString() ?? null,
                clientId: t.clientId,
                clientName: t.client?.displayName ?? null,
                stageName: t.client?.stage?.name ?? null,
                stageColor: t.client?.stage?.color ?? null,
                assignedUserId: t.assignedUserId,
                assignedName: t.assignedUser?.name ?? null,
                typeName: t.taskType?.name ?? null,
                createdBySystem: t.createdBySystem,
              }))}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
