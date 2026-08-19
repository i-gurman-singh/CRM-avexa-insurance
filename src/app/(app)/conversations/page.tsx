import Link from 'next/link';
import { BotIcon, MessageSquareIcon } from 'lucide-react';
import { timeAgo } from '@/lib/dates';
import { cn, formatPhone, truncate } from '@/lib/utils';
import { requireAuth } from '@/core/auth/session';
import {
  conversationCounts,
  listConversations,
  type ConversationFilter,
} from '@/core/messaging/service';
import {
  Avatar,
  Badge,
  Card,
  CardContent,
  ColorBadge,
  EmptyState,
  PageHeader,
  PriorityDot,
} from '@/ui/components/primitives';

export const metadata = { title: 'Conversations' };
export const dynamic = 'force-dynamic';

/**
 * Conversation monitoring.
 *
 * The filters are the point of this screen: "who is waiting on us", "who
 * objected to the price", "who stopped responding", "where was AI unsure".
 * Each one is a saved view over labels the classifier already applied, so
 * opening this page costs one indexed query, not a batch of AI calls.
 */

const FILTERS: Array<{ key: ConversationFilter; label: string; description: string }> = [
  { key: 'all', label: 'All', description: 'Every open conversation' },
  { key: 'unread', label: 'Unread', description: 'Nobody has looked at these yet' },
  { key: 'needs_response', label: 'Needs a response', description: 'Client spoke last' },
  { key: 'new', label: 'New today', description: 'Started in the last 24 hours' },
  { key: 'ready_to_bind', label: 'Ready to bind', description: 'Client agreed to proceed' },
  { key: 'price_objection', label: 'Price objection', description: 'Client said it was too expensive' },
  { key: 'missing_documents', label: 'Missing documents', description: 'Waiting on paperwork' },
  { key: 'stopped_responding', label: 'Gone quiet', description: 'No reply for 48 hours' },
  { key: 'high_priority', label: 'High priority', description: 'Flagged urgent' },
  { key: 'ai_uncertain', label: 'AI unsure', description: 'The classifier had low confidence' },
];

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; scope?: string; q?: string }>;
}) {
  const user = await requireAuth();
  const { filter: rawFilter, scope, q } = await searchParams;

  const filter = (FILTERS.find((f) => f.key === rawFilter)?.key ?? 'all') as ConversationFilter;
  const assignedUserId = scope === 'mine' ? user.id : undefined;

  const [{ items, total }, counts] = await Promise.all([
    listConversations({ filter, assignedUserId, search: q, take: 100 }),
    conversationCounts(assignedUserId),
  ]);

  const active = FILTERS.find((f) => f.key === filter)!;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Conversations"
        description={active.description}
        actions={
          <div className="flex rounded-md border border-border p-0.5 text-xs">
            <Link
              href={`/conversations?filter=${filter}`}
              className={cn(
                'rounded px-2.5 py-1',
                scope !== 'mine' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
              )}
            >
              Everyone
            </Link>
            <Link
              href={`/conversations?filter=${filter}&scope=mine`}
              className={cn(
                'rounded px-2.5 py-1',
                scope === 'mine' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
              )}
            >
              Mine
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const count = counts[f.key] ?? 0;
          const isActive = f.key === filter;
          return (
            <Link
              key={f.key}
              href={`/conversations?filter=${f.key}${scope === 'mine' ? '&scope=mine' : ''}`}
              title={f.description}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
                isActive
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-surface text-muted-foreground hover:bg-accent',
              )}
            >
              {f.label}
              {count > 0 ? (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[10px] tabular-nums',
                    isActive ? 'bg-white/20' : 'bg-surface-muted',
                  )}
                >
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>

      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <EmptyState
              icon={<MessageSquareIcon className="size-7" />}
              title="Nothing here"
              description={`No conversations match "${active.label}".`}
            />
          ) : (
            <ul className="divide-y divide-border">
              {items.map((conversation) => {
                const last = conversation.messages[0];
                return (
                  <li key={conversation.id}>
                    <Link
                      href={`/clients/${conversation.clientId}?tab=conversation`}
                      className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-muted"
                    >
                      <Avatar name={conversation.client.displayName} size="md" />

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {conversation.client.displayName}
                          </span>
                          {conversation.unreadCount > 0 ? (
                            <Badge tone="primary" className="px-1.5 py-0 text-[10px]">
                              {conversation.unreadCount} new
                            </Badge>
                          ) : null}
                          {conversation.priority === 'URGENT' || conversation.priority === 'HIGH' ? (
                            <PriorityDot priority={conversation.priority} />
                          ) : null}
                          {conversation.aiUncertain ? (
                            <Badge tone="warning" className="gap-1 px-1.5 py-0 text-[10px]">
                              <BotIcon className="size-2.5" aria-hidden />
                              unsure
                            </Badge>
                          ) : null}
                        </div>

                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {last?.body
                            ? `${last.direction === 'OUTBOUND' ? 'You: ' : ''}${truncate(last.body, 110)}`
                            : formatPhone(conversation.client.phone)}
                        </p>

                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <ColorBadge color={conversation.client.stage.color}>
                            {conversation.client.stage.name}
                          </ColorBadge>
                          {last?.analysis ? (
                            <Badge tone="info" className="px-1.5 py-0 text-[10px]">
                              {last.analysis.intent.replace(/_/g, ' ')}
                            </Badge>
                          ) : null}
                          {conversation.labels.map((label) => (
                            <Badge key={label} tone="neutral" className="px-1.5 py-0 text-[10px]">
                              {label.replace(/_/g, ' ')}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      <div className="shrink-0 space-y-1 text-right">
                        <p className="text-xs text-muted-foreground">
                          {conversation.lastMessageAt ? timeAgo(conversation.lastMessageAt) : '—'}
                        </p>
                        {conversation.client.assignedUser ? (
                          <Avatar
                            name={conversation.client.assignedUser.name}
                            src={conversation.client.assignedUser.avatarUrl}
                            size="sm"
                          />
                        ) : (
                          <span className="text-[10px] text-muted-foreground">Unassigned</span>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {total > items.length ? (
        <p className="text-center text-xs text-muted-foreground">
          Showing {items.length} of {total}. Narrow the filter to see the rest.
        </p>
      ) : null}
    </div>
  );
}
