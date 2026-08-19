import Link from 'next/link';
import {
  AlertTriangleIcon,
  CheckSquareIcon,
  ClockIcon,
  MessageSquareIcon,
  SparklesIcon,
} from 'lucide-react';
import { formatDueDate, formatDate, timeAgo } from '@/lib/dates';
import { formatPhone } from '@/lib/utils';
import { requireAuth } from '@/core/auth/session';
import { getDashboard } from '@/core/dashboard/service';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ColorBadge,
  EmptyState,
  PageHeader,
  PriorityDot,
} from '@/ui/components/primitives';
import { StatCard } from '@/ui/components/stat-card';

export const metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

/**
 * The dashboard.
 *
 * Organised around one question: what needs doing today? Cards link straight
 * to the filtered list that answers them, and the three panels below are the
 * actual work queues rather than a summary of them.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const user = await requireAuth();
  const { scope } = await searchParams;
  const mine = scope !== 'all';

  const data = await getDashboard({ assignedUserId: mine ? user.id : null });

  const firstName = user.name.split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting}, ${firstName}`}
        description={`Here's what needs your attention. Updated ${timeAgo(data.generatedAt)}.`}
        actions={
          <div className="flex rounded-md border border-border p-0.5">
            <Button asChild variant={mine ? 'primary' : 'ghost'} size="sm">
              <Link href="/">My work</Link>
            </Button>
            <Button asChild variant={mine ? 'ghost' : 'primary'} size="sm">
              <Link href="/?scope=all">Whole team</Link>
            </Button>
          </div>
        }
      />

      <section aria-label="Key numbers">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
          {data.cards.map((card) => (
            <StatCard
              key={card.key}
              label={card.label}
              value={card.value}
              href={card.href}
              tone={card.tone}
              hint={card.hint}
            />
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {/* Follow-ups ------------------------------------------------------ */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClockIcon className="size-4 text-warning" aria-hidden />
              Follow-ups due
            </CardTitle>
            <Button asChild variant="link" size="sm">
              <Link href="/follow-ups">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {data.todaysFollowUps.length === 0 ? (
              <EmptyState title="Nothing due" description="No follow-ups are waiting on you today." />
            ) : (
              <ul className="divide-y divide-border">
                {data.todaysFollowUps.map((f) => (
                  <li key={f.id}>
                    <Link
                      href={`/clients/${f.clientId}`}
                      className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-muted"
                    >
                      <PriorityDot priority={f.priority} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {f.client.displayName}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {f.reason ?? f.reasonKey.replace(/_/g, ' ')}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDueDate(f.dueAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Tasks ----------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckSquareIcon className="size-4 text-info" aria-hidden />
              Tasks due today
            </CardTitle>
            <Button asChild variant="link" size="sm">
              <Link href="/tasks">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {data.todaysTasks.length === 0 ? (
              <EmptyState title="All clear" description="No tasks are due today." />
            ) : (
              <ul className="divide-y divide-border">
                {data.todaysTasks.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={t.clientId ? `/clients/${t.clientId}` : '/tasks'}
                      className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-muted"
                    >
                      <PriorityDot priority={t.priority} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{t.title}</span>
                        {t.client ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {t.client.displayName}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDueDate(t.dueAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Conversations --------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquareIcon className="size-4 text-primary" aria-hidden />
              Waiting on a reply
            </CardTitle>
            <Button asChild variant="link" size="sm">
              <Link href="/conversations?filter=unread">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {data.recentConversations.length === 0 ? (
              <EmptyState title="Inbox clear" description="Every conversation has been read." />
            ) : (
              <ul className="divide-y divide-border">
                {data.recentConversations.map((c) => {
                  const last = c.messages[0];
                  return (
                    <li key={c.id}>
                      <Link
                        href={`/clients/${c.clientId}`}
                        className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-muted"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">
                              {c.client.displayName}
                            </span>
                            {c.unreadCount > 0 ? (
                              <Badge tone="primary" className="px-1.5 py-0 text-[10px]">
                                {c.unreadCount}
                              </Badge>
                            ) : null}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {last?.body ?? formatPhone(c.client.phone)}
                          </span>
                          {last?.analysis ? (
                            <span className="mt-1 inline-flex">
                              <Badge tone="info" className="px-1.5 py-0 text-[10px]">
                                {last.analysis.intent.replace(/_/g, ' ')}
                              </Badge>
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {c.lastMessageAt ? timeAgo(c.lastMessageAt) : ''}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Needs attention ------------------------------------------------- */}
        <Card className="lg:col-span-2 xl:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangleIcon className="size-4 text-critical" aria-hidden />
              Leads needing attention
            </CardTitle>
            <Button asChild variant="link" size="sm">
              <Link href="/clients?needsAttention=true">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {data.attentionClients.length === 0 ? (
              <EmptyState
                icon={<SparklesIcon className="size-6" />}
                title="Nothing flagged"
                description="No leads are stalled or waiting on a response."
              />
            ) : (
              <ul className="divide-y divide-border">
                {data.attentionClients.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/clients/${c.id}`}
                      className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{c.displayName}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {c.attentionReason ?? 'Needs review'}
                        </span>
                      </span>
                      <ColorBadge color={c.stage.color}>{c.stage.name}</ColorBadge>
                      <span className="w-28 shrink-0 text-right text-xs text-muted-foreground">
                        {formatDate(c.lastActivityAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
