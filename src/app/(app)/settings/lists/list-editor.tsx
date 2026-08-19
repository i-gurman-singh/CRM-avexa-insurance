'use client';

import { useState, useTransition } from 'react';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  createAgeGroupAction,
  createInsuranceCompanyAction,
  createLeadSourceAction,
  createLostReasonAction,
  createQuoteStatusAction,
  createTaskTypeAction,
  deleteAgeGroupAction,
  updateAgeGroupAction,
  updateInsuranceCompanyAction,
  updateLeadSourceAction,
  updateLostReasonAction,
  updateQuoteStatusAction,
  updateTaskTypeAction,
} from '@/server/actions/settings';
import { Badge, Button, Field, Input } from '@/ui/components/primitives';

/**
 * Generic editor for the simple name + active lists.
 *
 * One component covers six lists because they genuinely have the same shape;
 * anything that grows its own fields (document types, age groups) gets its own
 * editor rather than being bent into this one.
 */

type Kind = 'company' | 'leadSource' | 'lostReason' | 'taskType' | 'quoteStatus';

export interface ListItem {
  id: string;
  name: string;
  detail?: string;
  color?: string;
  isActive: boolean;
}

const CREATE: Record<Kind, (name: string) => Promise<{ ok: boolean; error?: string }>> = {
  company: (name) => createInsuranceCompanyAction({ name }),
  leadSource: (name) => createLeadSourceAction(name),
  lostReason: (name) => createLostReasonAction(name),
  taskType: (name) => createTaskTypeAction({ name }),
  quoteStatus: (name) => createQuoteStatusAction({ name }),
};

const UPDATE: Record<
  Kind,
  (id: string, input: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>
> = {
  company: updateInsuranceCompanyAction,
  leadSource: updateLeadSourceAction,
  lostReason: updateLostReasonAction,
  taskType: updateTaskTypeAction,
  quoteStatus: updateQuoteStatusAction,
};

export function ListEditor({
  kind,
  items,
  canManage,
  addLabel,
}: {
  kind: Kind;
  items: ListItem[];
  canManage: boolean;
  addLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);

  return (
    <>
      {error ? (
        <p className="border-b border-border bg-critical-subtle px-4 py-2 text-xs text-critical" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li
            key={item.id}
            className={cn('flex flex-wrap items-center gap-3 px-4 py-2.5', !item.isActive && 'opacity-55')}
          >
            {item.color ? (
              <span
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: item.color }}
                aria-hidden
              />
            ) : null}

            {renaming === item.id ? (
              <form
                className="flex flex-1 items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = new FormData(e.currentTarget).get('name');
                  startTransition(async () => {
                    const result = await UPDATE[kind](item.id, { name: value });
                    if (result.ok) setRenaming(null);
                    else setError(result.error ?? 'Could not rename');
                  });
                }}
              >
                <Input name="name" defaultValue={item.name} autoFocus className="h-8 max-w-64 text-sm" />
                <Button type="submit" size="sm" loading={pending}>
                  Save
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(null)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{item.name}</span>
                {item.detail ? (
                  <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
                ) : null}
              </span>
            )}

            {!item.isActive ? <Badge tone="neutral">Inactive</Badge> : null}

            {canManage && renaming !== item.id ? (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => setRenaming(item.id)}>
                  Rename
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await UPDATE[kind](item.id, { isActive: !item.isActive });
                      if (!result.ok) setError(result.error ?? 'Could not update');
                    })
                  }
                >
                  {item.isActive ? 'Deactivate' : 'Reactivate'}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {canManage ? (
        <div className="border-t border-border p-4">
          {adding ? (
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const value = String(new FormData(e.currentTarget).get('name') ?? '');
                startTransition(async () => {
                  const result = await CREATE[kind](value);
                  if (result.ok) setAdding(false);
                  else setError(result.error ?? 'Could not add');
                });
              }}
            >
              <Field label="Name" htmlFor={`add-${kind}`}>
                <Input id={`add-${kind}`} name="name" required autoFocus className="w-64" />
              </Field>
              <Button type="submit" size="sm" loading={pending}>
                Add
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <PlusIcon className="size-3.5" />
              {addLabel}
            </Button>
          )}
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Age groups — needs min/max, so it gets its own editor
// ---------------------------------------------------------------------------

export interface AgeGroupRow {
  id: string;
  name: string;
  minAge: number;
  maxAge: number | null;
  isActive: boolean;
}

export function AgeGroupEditor({
  groups,
  canManage,
}: {
  groups: AgeGroupRow[];
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Warn about holes or overlaps — a silently mis-bucketed report is worse
  // than an obviously broken one.
  const sorted = [...groups].filter((g) => g.isActive).sort((a, b) => a.minAge - b.minAge);
  const problems: string[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1]!;
    const current = sorted[i]!;
    if (previous.maxAge === null) continue;
    if (current.minAge > previous.maxAge + 1) {
      problems.push(`Ages ${previous.maxAge + 1}–${current.minAge - 1} are in no group`);
    } else if (current.minAge <= previous.maxAge) {
      problems.push(`${previous.name} and ${current.name} overlap`);
    }
  }

  return (
    <>
      {error ? (
        <p className="border-b border-border bg-critical-subtle px-4 py-2 text-xs text-critical" role="alert">
          {error}
        </p>
      ) : null}

      {problems.length > 0 ? (
        <p className="border-b border-border bg-warning-subtle px-4 py-2 text-xs text-warning">
          {problems.join('. ')}.
        </p>
      ) : null}

      <ul className="divide-y divide-border">
        {groups.map((group) => (
          <li
            key={group.id}
            className={cn('flex flex-wrap items-center gap-3 px-4 py-2.5', !group.isActive && 'opacity-55')}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm">{group.name}</span>
              <span className="block text-xs text-muted-foreground">
                {group.minAge}–{group.maxAge ?? '∞'}
              </span>
            </span>

            {canManage ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await updateAgeGroupAction(group.id, {
                        isActive: !group.isActive,
                      });
                      if (!result.ok) setError(result.error ?? 'Could not update');
                    })
                  }
                >
                  {group.isActive ? 'Deactivate' : 'Reactivate'}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${group.name}`}
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await deleteAgeGroupAction(group.id);
                      if (!result.ok) setError(result.error ?? 'Could not delete');
                    })
                  }
                >
                  <Trash2Icon className="size-3.5 text-critical" />
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {canManage ? (
        <div className="border-t border-border p-4">
          {adding ? (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                startTransition(async () => {
                  const result = await createAgeGroupAction({
                    name: data.get('name'),
                    minAge: Number(data.get('minAge')),
                    maxAge: data.get('maxAge') ? Number(data.get('maxAge')) : null,
                  });
                  if (result.ok) setAdding(false);
                  else setError(result.error ?? 'Could not add');
                });
              }}
            >
              <Field label="Label" htmlFor="ag-name">
                <Input id="ag-name" name="name" required autoFocus placeholder="26–30" className="w-32" />
              </Field>
              <Field label="From age" htmlFor="ag-min">
                <Input id="ag-min" name="minAge" type="number" required className="w-24" />
              </Field>
              <Field label="To age" htmlFor="ag-max" hint="Blank = no limit">
                <Input id="ag-max" name="maxAge" type="number" className="w-24" />
              </Field>
              <Button type="submit" size="sm" loading={pending}>
                Add
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <PlusIcon className="size-3.5" />
              Add an age group
            </Button>
          )}
        </div>
      ) : null}
    </>
  );
}
