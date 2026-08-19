'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { FilterXIcon, SearchIcon } from 'lucide-react';
import { Button, Card, Input, Select } from '@/ui/components/primitives';

/**
 * Client list filters.
 *
 * State lives in the URL, not in React: a filtered list is then shareable,
 * bookmarkable, and survives a refresh — which is what people actually do with
 * "everyone waiting on documents".
 */
export function ClientFilters({
  stages,
  users,
  sources,
  ageGroups,
}: {
  stages: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string }>;
  sources: Array<{ id: string; name: string }>;
  ageGroups: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '' || value === 'all') next.delete(key);
      else next.set(key, value);
    }
    next.delete('page');
    router.push(`/clients?${next.toString()}`);
  }

  const hasFilters = ['stageIds', 'assignee', 'leadSourceIds', 'ageGroupIds', 'followUpStatus', 'needsAttention', 'hasUnread', 'q'].some(
    (k) => params.get(k),
  );

  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-[240px] flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: query });
          }}
        >
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, phone, email, VIN, licence, policy, company…"
            aria-label="Search clients"
            className="pl-8"
          />
        </form>

        <Select
          value={params.get('stageIds') ?? 'all'}
          onChange={(e) => update({ stageIds: e.target.value })}
          aria-label="Stage"
          className="w-auto min-w-36"
        >
          <option value="all">All stages</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>

        <Select
          value={params.get('assignee') ?? 'all'}
          onChange={(e) => update({ assignee: e.target.value })}
          aria-label="Assigned to"
          className="w-auto min-w-36"
        >
          <option value="all">Anyone</option>
          <option value="me">Assigned to me</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>

        <Select
          value={params.get('leadSourceIds') ?? 'all'}
          onChange={(e) => update({ leadSourceIds: e.target.value })}
          aria-label="Lead source"
          className="w-auto min-w-32"
        >
          <option value="all">Any source</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>

        <Select
          value={params.get('ageGroupIds') ?? 'all'}
          onChange={(e) => update({ ageGroupIds: e.target.value })}
          aria-label="Age group"
          className="w-auto min-w-28"
        >
          <option value="all">Any age</option>
          {ageGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>

        <Select
          value={params.get('followUpStatus') ?? 'all'}
          onChange={(e) => update({ followUpStatus: e.target.value })}
          aria-label="Follow-up status"
          className="w-auto min-w-36"
        >
          <option value="all">Any follow-up</option>
          <option value="overdue">Follow-up overdue</option>
          <option value="due_today">Follow-up due today</option>
          <option value="upcoming">Follow-up upcoming</option>
          <option value="none">No follow-up set</option>
        </Select>

        <Button
          variant={params.get('needsAttention') === 'true' ? 'primary' : 'outline'}
          size="sm"
          onClick={() =>
            update({ needsAttention: params.get('needsAttention') === 'true' ? null : 'true' })
          }
        >
          Needs attention
        </Button>

        <Button
          variant={params.get('hasUnread') === 'true' ? 'primary' : 'outline'}
          size="sm"
          onClick={() => update({ hasUnread: params.get('hasUnread') === 'true' ? null : 'true' })}
        >
          Unread
        </Button>

        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={() => router.push('/clients')}>
            <FilterXIcon className="size-3.5" />
            Clear
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
