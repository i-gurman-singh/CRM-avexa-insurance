'use client';

import { useState, useTransition } from 'react';
import { BotIcon, PlusIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createDocumentTypeAction, updateDocumentTypeAction } from '@/server/actions/settings';
import { Badge, Button, Field, Input, Select, Textarea } from '@/ui/components/primitives';

export interface DocumentTypeRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  extractorKey: string | null;
  requiredByDefault: boolean;
  requestTemplate: string | null;
  isActive: boolean;
}

export function DocumentTypeEditor({
  types,
  extractorKeys,
  canManage,
}: {
  types: DocumentTypeRow[];
  extractorKeys: string[];
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <>
      {error ? (
        <p className="border-b border-border bg-critical-subtle px-4 py-2 text-xs text-critical" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-border">
        {types.map((type) => (
          <li key={type.id} className={cn('px-4 py-3', !type.isActive && 'opacity-55')}>
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {type.name}
                  {type.requiredByDefault ? <Badge tone="warning">Required</Badge> : null}
                  {type.extractorKey ? (
                    <Badge tone="info" className="gap-1">
                      <BotIcon className="size-2.5" aria-hidden />
                      {type.extractorKey}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Stored only</Badge>
                  )}
                  {!type.isActive ? <Badge tone="neutral">Inactive</Badge> : null}
                </p>
                {type.description ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">{type.description}</p>
                ) : null}
                {type.requestTemplate ? (
                  <p className="mt-1 rounded bg-surface-muted px-2 py-1 text-xs text-muted-foreground">
                    &ldquo;{type.requestTemplate}&rdquo;
                  </p>
                ) : null}
              </div>

              {canManage ? (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(editing === type.id ? null : type.id)}
                  >
                    {editing === type.id ? 'Close' : 'Edit'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await updateDocumentTypeAction(type.id, {
                          isActive: !type.isActive,
                        });
                        if (!result.ok) setError(result.error);
                      })
                    }
                  >
                    {type.isActive ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </div>
              ) : null}
            </div>

            {editing === type.id ? (
              <form
                className="mt-3 grid gap-3 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  startTransition(async () => {
                    const result = await updateDocumentTypeAction(type.id, {
                      name: data.get('name'),
                      description: data.get('description') || null,
                      extractorKey: data.get('extractorKey') || null,
                      requiredByDefault: data.get('requiredByDefault') === 'on',
                      requestTemplate: data.get('requestTemplate') || null,
                    });
                    if (result.ok) setEditing(null);
                    else setError(result.error);
                  });
                }}
              >
                <Field label="Name" htmlFor={`dn-${type.id}`}>
                  <Input id={`dn-${type.id}`} name="name" defaultValue={type.name} required />
                </Field>
                <Field
                  label="AI extractor"
                  htmlFor={`de-${type.id}`}
                  hint="Which extraction schema AI should try to fill"
                >
                  <Select
                    id={`de-${type.id}`}
                    name="extractorKey"
                    defaultValue={type.extractorKey ?? ''}
                  >
                    <option value="">None — store the file only</option>
                    {extractorKeys.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Description" htmlFor={`dd-${type.id}`} className="sm:col-span-2">
                  <Input
                    id={`dd-${type.id}`}
                    name="description"
                    defaultValue={type.description ?? ''}
                  />
                </Field>
                <Field
                  label="Request message"
                  htmlFor={`dt-${type.id}`}
                  className="sm:col-span-2"
                  hint="What the CRM says when asking the client for this"
                >
                  <Textarea
                    id={`dt-${type.id}`}
                    name="requestTemplate"
                    rows={2}
                    defaultValue={type.requestTemplate ?? ''}
                  />
                </Field>
                <div className="flex items-center gap-3 sm:col-span-2">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      name="requiredByDefault"
                      defaultChecked={type.requiredByDefault}
                      className="size-4 accent-[var(--color-primary)]"
                    />
                    Required before binding
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
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                startTransition(async () => {
                  const result = await createDocumentTypeAction({
                    name: data.get('name'),
                    description: data.get('description') || undefined,
                    extractorKey: data.get('extractorKey') || null,
                    requiredByDefault: data.get('requiredByDefault') === 'on',
                    requestTemplate: data.get('requestTemplate') || null,
                  });
                  if (result.ok) setAdding(false);
                  else setError(result.error);
                });
              }}
            >
              <Field label="Name" htmlFor="new-dt-name" required>
                <Input id="new-dt-name" name="name" required autoFocus placeholder="e.g. Proof of address" />
              </Field>
              <Field label="AI extractor" htmlFor="new-dt-extractor">
                <Select id="new-dt-extractor" name="extractorKey" defaultValue="generic">
                  <option value="">None — store the file only</option>
                  {extractorKeys.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Request message" htmlFor="new-dt-template" className="sm:col-span-2">
                <Textarea id="new-dt-template" name="requestTemplate" rows={2} />
              </Field>
              <div className="flex items-center gap-3 sm:col-span-2">
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    name="requiredByDefault"
                    className="size-4 accent-[var(--color-primary)]"
                  />
                  Required before binding
                </label>
                <Button type="submit" size="sm" loading={pending}>
                  Add type
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <PlusIcon className="size-3.5" />
              Add a document type
            </Button>
          )}
        </div>
      ) : null}
    </>
  );
}
