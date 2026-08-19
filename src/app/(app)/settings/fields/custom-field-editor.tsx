'use client';

import { useState, useTransition } from 'react';
import { PlusIcon } from 'lucide-react';
import { createCustomFieldAction, updateCustomFieldAction } from '@/server/actions/settings';
import { Badge, Button, EmptyState, Field, Input, Select } from '@/ui/components/primitives';

export interface CustomFieldRow {
  id: string;
  entity: string;
  key: string;
  label: string;
  fieldType: string;
  required: boolean;
  helpText: string | null;
  isActive: boolean;
}

const ENTITIES = [
  { value: 'client', label: 'Client' },
  { value: 'driver', label: 'Driver' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'quote', label: 'Quote' },
  { value: 'policy', label: 'Policy' },
];

const TYPES = ['text', 'number', 'date', 'boolean', 'select', 'phone', 'email'];

export function CustomFieldEditor({
  fields,
  canManage,
}: {
  fields: CustomFieldRow[];
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const grouped = ENTITIES.map((entity) => ({
    ...entity,
    items: fields.filter((f) => f.entity === entity.value),
  })).filter((g) => g.items.length > 0);

  return (
    <>
      {error ? (
        <p className="border-b border-border bg-critical-subtle px-4 py-2 text-xs text-critical" role="alert">
          {error}
        </p>
      ) : null}

      {grouped.length === 0 ? (
        <EmptyState
          title="No custom fields yet"
          description="The built-in fields cover most brokerages. Add one when you find yourself putting something important in the notes every time."
        />
      ) : (
        grouped.map((group) => (
          <section key={group.value}>
            <h3 className="border-b border-border bg-surface-muted px-4 py-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {group.label}
            </h3>
            <ul className="divide-y divide-border">
              {group.items.map((field) => (
                <li key={field.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{field.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      <code className="font-mono">{field.key}</code> · {field.fieldType}
                      {field.helpText ? ` · ${field.helpText}` : ''}
                    </span>
                  </span>
                  {field.required ? <Badge tone="warning">Required</Badge> : null}
                  {canManage ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await updateCustomFieldAction(field.id, {
                            isActive: !field.isActive,
                          });
                          if (!result.ok) setError(result.error);
                        })
                      }
                    >
                      Remove
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {canManage ? (
        <div className="border-t border-border p-4">
          {adding ? (
            <form
              className="grid gap-3 sm:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                startTransition(async () => {
                  const result = await createCustomFieldAction({
                    entity: data.get('entity'),
                    label: data.get('label'),
                    fieldType: data.get('fieldType'),
                    required: data.get('required') === 'on',
                    helpText: data.get('helpText') || undefined,
                  });
                  if (result.ok) setAdding(false);
                  else setError(result.error);
                });
              }}
            >
              <Field label="On" htmlFor="cf-entity">
                <Select id="cf-entity" name="entity" defaultValue="client">
                  {ENTITIES.map((e) => (
                    <option key={e.value} value={e.value}>
                      {e.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Label" htmlFor="cf-label" required>
                <Input id="cf-label" name="label" required autoFocus placeholder="e.g. Broker of record date" />
              </Field>
              <Field label="Type" htmlFor="cf-type">
                <Select id="cf-type" name="fieldType" defaultValue="text">
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Help text" htmlFor="cf-help">
                <Input id="cf-help" name="helpText" />
              </Field>
              <div className="flex items-center gap-3 sm:col-span-4">
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" name="required" className="size-4 accent-[var(--color-primary)]" />
                  Required
                </label>
                <Button type="submit" size="sm" loading={pending}>
                  Add field
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <PlusIcon className="size-3.5" />
              Add a custom field
            </Button>
          )}
        </div>
      ) : null}
    </>
  );
}
