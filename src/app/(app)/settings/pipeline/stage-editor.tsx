'use client';

import { useState, useTransition } from 'react';
import { ChevronDownIcon, ChevronUpIcon, PlusIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  createStageAction,
  reorderStagesAction,
  setStageActiveAction,
  updateStageAction,
} from '@/server/actions/settings';
import { Badge, Button, Field, Input, Select } from '@/ui/components/primitives';

export interface StageRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string;
  color: string;
  position: number;
  isDefault: boolean;
  isActive: boolean;
  staleAfterHours: number | null;
  clientCount: number;
}

const CATEGORIES = [
  { value: 'OPEN', label: 'Open — work in progress' },
  { value: 'WON', label: 'Won — business closed' },
  { value: 'LOST', label: 'Lost — no longer pursuing' },
  { value: 'DORMANT', label: 'Dormant — parked for later' },
];

export function StageEditor({ stages, canManage }: { stages: StageRow[]; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  function move(index: number, direction: -1 | 1) {
    const next = [...stages];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    startTransition(async () => {
      const result = await reorderStagesAction(next.map((s) => s.id));
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <>
      {error ? (
        <p className="border-b border-border bg-critical-subtle px-4 py-2 text-xs text-critical" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-border">
        {stages.map((stage, index) => (
          <li key={stage.id} className={cn('px-4 py-3', !stage.isActive && 'opacity-60')}>
            <div className="flex flex-wrap items-center gap-3">
              {canManage ? (
                <div className="flex flex-col">
                  <button
                    type="button"
                    aria-label={`Move ${stage.name} up`}
                    disabled={index === 0 || pending}
                    onClick={() => move(index, -1)}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronUpIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${stage.name} down`}
                    disabled={index === stages.length - 1 || pending}
                    onClick={() => move(index, 1)}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronDownIcon className="size-3.5" />
                  </button>
                </div>
              ) : null}

              <span
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: stage.color }}
                aria-hidden
              />

              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {stage.name}
                  {stage.isDefault ? <Badge tone="primary">New leads land here</Badge> : null}
                  {!stage.isActive ? <Badge tone="neutral">Inactive</Badge> : null}
                  <Badge tone="outline">{stage.category.toLowerCase()}</Badge>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <code className="font-mono">{stage.key}</code> · {stage.clientCount} client
                  {stage.clientCount === 1 ? '' : 's'}
                  {stage.staleAfterHours ? ` · flags after ${stage.staleAfterHours}h` : ''}
                </p>
              </div>

              {canManage ? (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(editing === stage.id ? null : stage.id)}
                  >
                    {editing === stage.id ? 'Close' : 'Edit'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await setStageActiveAction(stage.id, !stage.isActive);
                        if (!result.ok) setError(result.error);
                      })
                    }
                  >
                    {stage.isActive ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </div>
              ) : null}
            </div>

            {editing === stage.id ? (
              <form
                className="mt-3 grid gap-3 sm:grid-cols-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  startTransition(async () => {
                    const result = await updateStageAction(stage.id, {
                      name: data.get('name'),
                      description: data.get('description') || null,
                      category: data.get('category'),
                      color: data.get('color'),
                      isDefault: data.get('isDefault') === 'on',
                      staleAfterHours: data.get('staleAfterHours')
                        ? Number(data.get('staleAfterHours'))
                        : null,
                    });
                    if (result.ok) setEditing(null);
                    else setError(result.error);
                  });
                }}
              >
                <Field label="Name" htmlFor={`n-${stage.id}`}>
                  <Input id={`n-${stage.id}`} name="name" defaultValue={stage.name} required />
                </Field>
                <Field label="Category" htmlFor={`c-${stage.id}`}>
                  <Select id={`c-${stage.id}`} name="category" defaultValue={stage.category}>
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Colour" htmlFor={`col-${stage.id}`}>
                  <Input
                    id={`col-${stage.id}`}
                    name="color"
                    type="color"
                    defaultValue={stage.color}
                    className="h-9.5 p-1"
                  />
                </Field>
                <Field
                  label="Flag after (hours)"
                  htmlFor={`s-${stage.id}`}
                  hint="Blank uses the global default"
                >
                  <Input
                    id={`s-${stage.id}`}
                    name="staleAfterHours"
                    type="number"
                    defaultValue={stage.staleAfterHours ?? ''}
                  />
                </Field>
                <Field label="Description" htmlFor={`d-${stage.id}`} className="sm:col-span-3">
                  <Input
                    id={`d-${stage.id}`}
                    name="description"
                    defaultValue={stage.description ?? ''}
                  />
                </Field>
                <div className="flex items-end gap-3">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      name="isDefault"
                      defaultChecked={stage.isDefault}
                      className="size-4 accent-[var(--color-primary)]"
                    />
                    Default
                  </label>
                  <Button type="submit" size="sm" loading={pending}>
                    Save
                  </Button>
                </div>
              </form>
            ) : null}
          </li>
        ))}
      </ul>

      {canManage ? (
        <div className="border-t border-border p-4">
          {adding ? (
            <form
              className="grid gap-3 sm:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                startTransition(async () => {
                  const result = await createStageAction({
                    name: data.get('name'),
                    category: data.get('category'),
                    color: data.get('color'),
                  });
                  if (result.ok) setAdding(false);
                  else setError(result.error);
                });
              }}
            >
              <Field label="Name" htmlFor="new-stage-name" required>
                <Input id="new-stage-name" name="name" required autoFocus placeholder="e.g. Awaiting payment" />
              </Field>
              <Field label="Category" htmlFor="new-stage-category">
                <Select id="new-stage-category" name="category" defaultValue="OPEN">
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Colour" htmlFor="new-stage-color">
                <Input
                  id="new-stage-color"
                  name="color"
                  type="color"
                  defaultValue="#64748b"
                  className="h-9.5 p-1"
                />
              </Field>
              <div className="flex items-end gap-2">
                <Button type="submit" size="sm" loading={pending}>
                  Add stage
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <PlusIcon className="size-3.5" />
              Add a stage
            </Button>
          )}
        </div>
      ) : null}
    </>
  );
}
