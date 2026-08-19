import Link from 'next/link';
import { PlusIcon, UsersIcon } from 'lucide-react';
import { formatDate, timeAgo } from '@/lib/dates';
import { formatPhone } from '@/lib/utils';
import { requireAuth } from '@/core/auth/session';
import { searchClients } from '@/core/clients/service';
import { listAgeGroups, listLeadSources, listStages } from '@/core/settings/lookups';
import { listAssignableUsers } from '@/core/users/service';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ColorBadge,
  EmptyState,
  PageHeader,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@/ui/components/primitives';
import { ClientFilters } from './client-filters';

export const metadata = { title: 'Clients' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

function toArray(value: string | string[] | undefined): string[] | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value : value.split(',').filter(Boolean);
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAuth();
  const params = await searchParams;

  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const assignee = typeof params.assignee === 'string' ? params.assignee : undefined;

  const [stages, users, sources, ageGroups] = await Promise.all([
    listStages(),
    listAssignableUsers(),
    listLeadSources(),
    listAgeGroups(),
  ]);

  const { items, total } = await searchClients({
    query: typeof params.q === 'string' ? params.q : undefined,
    stageIds: toArray(params.stageIds),
    leadSourceIds: toArray(params.leadSourceIds),
    ageGroupIds: toArray(params.ageGroupIds),
    assignedUserIds:
      assignee === 'me' ? [user.id] : assignee && assignee !== 'all' ? [assignee] : undefined,
    needsAttention: params.needsAttention === 'true' ? true : undefined,
    hasUnread: params.hasUnread === 'true' ? true : undefined,
    followUpStatus:
      typeof params.followUpStatus === 'string'
        ? (params.followUpStatus as 'due_today' | 'overdue' | 'upcoming' | 'none')
        : undefined,
    includeArchived: params.includeArchived === 'true',
    sort: (typeof params.sort === 'string' ? params.sort : 'recent') as never,
    take: PAGE_SIZE,
    skip: (page - 1) * PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Clients"
        description={`${total} record${total === 1 ? '' : 's'}`}
        actions={
          <Button asChild size="sm">
            <Link href="/clients/new">
              <PlusIcon className="size-4" />
              New client
            </Link>
          </Button>
        }
      />

      <ClientFilters stages={stages} users={users} sources={sources} ageGroups={ageGroups} />

      <Card>
        {items.length === 0 ? (
          <EmptyState
            icon={<UsersIcon className="size-7" />}
            title="No clients match those filters"
            description="Try clearing a filter, or search by phone number, VIN or licence number."
          />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Client</TH>
                <TH>Stage</TH>
                <TH className="hidden md:table-cell">Assigned</TH>
                <TH className="hidden lg:table-cell">Quotes</TH>
                <TH className="hidden lg:table-cell">Source</TH>
                <TH className="hidden sm:table-cell">Last activity</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((client) => (
                <TR key={client.id}>
                  <TD>
                    <Link href={`/clients/${client.id}`} className="group block min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium group-hover:underline">
                          {client.displayName}
                        </span>
                        {client.unreadCount > 0 ? (
                          <Badge tone="primary" className="px-1.5 py-0 text-[10px]">
                            {client.unreadCount}
                          </Badge>
                        ) : null}
                        {client.needsAttention ? (
                          <Badge tone="critical" className="px-1.5 py-0 text-[10px]">
                            Attention
                          </Badge>
                        ) : null}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {formatPhone(client.phone)}
                        {client.email ? ` · ${client.email}` : ''}
                      </span>
                    </Link>
                  </TD>
                  <TD>
                    <ColorBadge color={client.stage.color}>{client.stage.name}</ColorBadge>
                  </TD>
                  <TD className="hidden md:table-cell">
                    {client.assignedUser ? (
                      <span className="flex items-center gap-2">
                        <Avatar
                          name={client.assignedUser.name}
                          src={client.assignedUser.avatarUrl}
                          size="sm"
                        />
                        <span className="truncate text-xs">{client.assignedUser.name}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Unassigned</span>
                    )}
                  </TD>
                  <TD className="hidden lg:table-cell text-xs tabular-nums">
                    {client._count.quotes || '—'}
                  </TD>
                  <TD className="hidden lg:table-cell text-xs text-muted-foreground">
                    {client.leadSource?.name ?? '—'}
                  </TD>
                  <TD className="hidden sm:table-cell text-xs text-muted-foreground">
                    <span title={formatDate(client.lastActivityAt)}>
                      {timeAgo(client.lastActivityAt)}
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {totalPages > 1 ? (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            {page > 1 ? (
              <Button asChild variant="outline" size="sm">
                <Link href={buildPageUrl(params, page - 1)}>Previous</Link>
              </Button>
            ) : null}
            {page < totalPages ? (
              <Button asChild variant="outline" size="sm">
                <Link href={buildPageUrl(params, page + 1)}>Next</Link>
              </Button>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}

function buildPageUrl(params: Record<string, string | string[] | undefined>, page: number): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === 'page' || value === undefined) continue;
    next.set(key, Array.isArray(value) ? value.join(',') : value);
  }
  next.set('page', String(page));
  return `/clients?${next.toString()}`;
}
