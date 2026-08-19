import Link from 'next/link';
import { BellIcon } from 'lucide-react';
import { timeAgo } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { requireAuth } from '@/core/auth/session';
import { listNotifications } from '@/core/notifications/service';
import { Badge, Card, CardContent, EmptyState, PageHeader } from '@/ui/components/primitives';
import { MarkAllReadButton, NotificationRow } from './notification-actions';

export const metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

const SEVERITY_TONE = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  CRITICAL: 'critical',
} as const;

export default async function NotificationsPage() {
  const user = await requireAuth();
  const notifications = await listNotifications(user.id, { take: 100 });
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description={unread > 0 ? `${unread} unread` : 'You are up to date'}
        actions={unread > 0 ? <MarkAllReadButton /> : null}
      />

      <Card>
        <CardContent className="p-0">
          {notifications.length === 0 ? (
            <EmptyState
              icon={<BellIcon className="size-7" />}
              title="Nothing yet"
              description="You'll be told about new leads, replies, clients ready to bind, and overdue follow-ups."
            />
          ) : (
            <ul className="divide-y divide-border">
              {notifications.map((n) => (
                <li key={n.id} className={cn(!n.readAt && 'bg-primary-subtle/30')}>
                  <NotificationRow id={n.id} unread={!n.readAt}>
                    <div className="flex flex-wrap items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={SEVERITY_TONE[n.severity]}>{n.type.replace(/[._]/g, ' ')}</Badge>
                          <span className="text-sm font-medium">{n.title}</span>
                        </div>
                        {n.body ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                        ) : null}
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</p>
                      </div>

                      {n.linkUrl ? (
                        <Link
                          href={n.linkUrl}
                          className="shrink-0 text-xs text-primary hover:underline"
                        >
                          Open
                        </Link>
                      ) : null}
                    </div>
                  </NotificationRow>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
