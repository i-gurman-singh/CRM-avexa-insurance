'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { SearchIcon } from 'lucide-react';
import { Input, Select } from '@/ui/components/primitives';

export function PipelineFilters({
  users,
  currentAssignee,
  query,
}: {
  users: Array<{ id: string; name: string }>;
  currentAssignee: string;
  query: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value && value !== 'all') next.set(key, value);
    else next.delete(key);
    router.push(`/pipeline?${next.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          defaultValue={query}
          placeholder="Filter by name or phone"
          aria-label="Filter clients"
          className="h-8 w-52 pl-8 text-xs"
          onKeyDown={(e) => {
            if (e.key === 'Enter') update('q', (e.target as HTMLInputElement).value);
          }}
        />
      </div>

      <Select
        value={currentAssignee}
        onChange={(e) => update('assignee', e.target.value)}
        aria-label="Filter by assignee"
        className="h-8 w-40 text-xs"
      >
        <option value="all">Everyone</option>
        <option value="me">Assigned to me</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
