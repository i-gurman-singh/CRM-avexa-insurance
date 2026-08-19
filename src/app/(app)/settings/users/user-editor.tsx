'use client';

import { useState, useTransition } from 'react';
import { KeyRoundIcon, PlusIcon, ShieldIcon } from 'lucide-react';
import { timeAgo } from '@/lib/dates';
import { cn } from '@/lib/utils';
import type { Permission } from '@/lib/rbac';
import {
  createUserAction,
  setPermissionOverrideAction,
  setUserPasswordAction,
  updateUserAction,
} from '@/server/actions/settings';
import { Avatar, Badge, Button, Field, Input, Select } from '@/ui/components/primitives';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  phone: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  permissionOverrides: Record<string, boolean>;
}

export function UserEditor({
  users,
  roles,
  permissions,
  rolePermissions,
  canManage,
  currentUserId,
}: {
  users: UserRow[];
  roles: Array<{ value: string; label: string; description: string }>;
  permissions: string[];
  rolePermissions: Record<string, string[]>;
  canManage: boolean;
  currentUserId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);

  return (
    <>
      {error ? (
        <p className="border-b border-border bg-critical-subtle px-4 py-2 text-xs text-critical" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-border">
        {users.map((u) => {
          const base = new Set(rolePermissions[u.role] ?? []);
          const overrideCount = Object.keys(u.permissionOverrides).length;

          return (
            <li key={u.id} className={cn('px-4 py-3', !u.isActive && 'opacity-55')}>
              <div className="flex flex-wrap items-center gap-3">
                <Avatar name={u.name} size="md" />

                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {u.name}
                    {u.id === currentUserId ? <Badge tone="primary">You</Badge> : null}
                    {!u.isActive ? <Badge tone="neutral">Disabled</Badge> : null}
                    {overrideCount > 0 ? (
                      <Badge tone="info" className="gap-1">
                        <ShieldIcon className="size-2.5" aria-hidden />
                        {overrideCount} exception{overrideCount === 1 ? '' : 's'}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {u.email}
                    {u.lastLoginAt ? ` · last signed in ${timeAgo(u.lastLoginAt)}` : ' · never signed in'}
                  </p>
                </div>

                {canManage ? (
                  <div className="flex flex-wrap items-center gap-1">
                    <Select
                      value={u.role}
                      aria-label={`Role for ${u.name}`}
                      className="h-8 w-auto min-w-36 text-xs"
                      disabled={pending}
                      onChange={(e) =>
                        startTransition(async () => {
                          const result = await updateUserAction(u.id, { role: e.target.value });
                          if (!result.ok) setError(result.error);
                        })
                      }
                    >
                      {roles.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </Select>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpanded(expanded === u.id ? null : u.id)}
                    >
                      Permissions
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Set password for ${u.name}`}
                      title="Set a new password"
                      onClick={() => setResetting(resetting === u.id ? null : u.id)}
                    >
                      <KeyRoundIcon className="size-3.5" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending || u.id === currentUserId}
                      title={u.id === currentUserId ? 'You cannot disable your own account' : undefined}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await updateUserAction(u.id, { isActive: !u.isActive });
                          if (!result.ok) setError(result.error);
                        })
                      }
                    >
                      {u.isActive ? 'Disable' : 'Enable'}
                    </Button>
                  </div>
                ) : (
                  <Badge tone="outline">{u.role.toLowerCase()}</Badge>
                )}
              </div>

              {resetting === u.id ? (
                <form
                  className="mt-3 flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const password = String(new FormData(e.currentTarget).get('password') ?? '');
                    startTransition(async () => {
                      const result = await setUserPasswordAction(u.id, password);
                      if (result.ok) setResetting(null);
                      else setError(result.error);
                    });
                  }}
                >
                  <Field
                    label="New password"
                    htmlFor={`pw-${u.id}`}
                    hint="At least 12 characters. Tell them to change it after signing in."
                  >
                    <Input id={`pw-${u.id}`} name="password" type="text" required className="w-72" autoFocus />
                  </Field>
                  <Button type="submit" size="sm" loading={pending}>
                    Set password
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setResetting(null)}>
                    Cancel
                  </Button>
                </form>
              ) : null}

              {expanded === u.id ? (
                <div className="mt-3 rounded-md border border-border bg-surface-muted/50 p-3">
                  <p className="mb-2 text-xs text-muted-foreground">
                    Ticked permissions come from the {u.role.toLowerCase()} role. Changing one here
                    creates an exception for this person only.
                  </p>
                  <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                    {permissions.map((permission) => {
                      const fromRole = base.has(permission);
                      const override = u.permissionOverrides[permission];
                      const effective = override ?? fromRole;

                      return (
                        <label
                          key={permission}
                          className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-accent"
                        >
                          <input
                            type="checkbox"
                            className="size-3.5 accent-[var(--color-primary)]"
                            checked={effective}
                            disabled={pending}
                            onChange={(e) =>
                              startTransition(async () => {
                                // Setting it back to the role default clears the exception.
                                const next = e.target.checked === fromRole ? null : e.target.checked;
                                const result = await setPermissionOverrideAction(
                                  u.id,
                                  permission as Permission,
                                  next,
                                );
                                if (!result.ok) setError(result.error);
                              })
                            }
                          />
                          <span className={cn('font-mono', override !== undefined && 'font-semibold text-info')}>
                            {permission}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
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
                  const result = await createUserAction({
                    name: data.get('name'),
                    email: data.get('email'),
                    password: data.get('password'),
                    role: data.get('role'),
                    phone: data.get('phone') || null,
                  });
                  if (result.ok) setAdding(false);
                  else setError(result.error);
                });
              }}
            >
              <Field label="Name" htmlFor="nu-name" required>
                <Input id="nu-name" name="name" required autoFocus />
              </Field>
              <Field label="Email" htmlFor="nu-email" required>
                <Input id="nu-email" name="email" type="email" required />
              </Field>
              <Field label="Role" htmlFor="nu-role">
                <Select id="nu-role" name="role" defaultValue="AGENT">
                  {roles.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Temporary password" htmlFor="nu-password" required hint="At least 12 characters">
                <Input id="nu-password" name="password" type="text" required />
              </Field>
              <div className="sm:col-span-2 flex gap-2">
                <Button type="submit" size="sm" loading={pending}>
                  Create user
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <PlusIcon className="size-3.5" />
              Add a user
            </Button>
          )}
        </div>
      ) : null}
    </>
  );
}
