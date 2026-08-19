'use client';

import { useState, useTransition } from 'react';
import { RotateCcwIcon } from 'lucide-react';
import type { SettingKey } from '@/core/settings/defaults';
import { resetSettingAction, setSettingAction } from '@/server/actions/settings';
import { Button, Input } from '@/ui/components/primitives';

export interface SettingRow {
  key: string;
  label: string;
  description: string;
  type: string;
  value: unknown;
  isOverridden: boolean;
}

export function SettingsEditor({
  settings,
  canManage,
}: {
  settings: SettingRow[];
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function save(key: string, value: unknown) {
    setError(null);
    startTransition(async () => {
      const result = await setSettingAction(key as SettingKey, value);
      if (result.ok) {
        setSaved(key);
        setTimeout(() => setSaved(null), 1500);
      } else setError(result.error);
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
        {settings.map((setting) => (
          <li key={setting.key} className="flex flex-wrap items-start gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{setting.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{setting.description}</p>
              {saved === setting.key ? (
                <p className="mt-1 text-[11px] text-success">Saved</p>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {setting.type === 'boolean' ? (
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-primary)]"
                    disabled={!canManage || pending}
                    defaultChecked={Boolean(setting.value)}
                    onChange={(e) => save(setting.key, e.target.checked)}
                  />
                  {setting.value ? 'On' : 'Off'}
                </label>
              ) : setting.type === 'number' ? (
                <Input
                  type="number"
                  step="any"
                  disabled={!canManage || pending}
                  defaultValue={String(setting.value ?? '')}
                  className="h-8 w-24 text-xs"
                  aria-label={setting.label}
                  onBlur={(e) => {
                    if (String(setting.value) !== e.target.value) save(setting.key, e.target.value);
                  }}
                />
              ) : setting.type === 'string' ? (
                <Input
                  disabled={!canManage || pending}
                  defaultValue={String(setting.value ?? '')}
                  className="h-8 w-56 text-xs"
                  aria-label={setting.label}
                  onBlur={(e) => {
                    if (String(setting.value) !== e.target.value) save(setting.key, e.target.value);
                  }}
                />
              ) : (
                <code className="max-w-64 truncate rounded bg-surface-muted px-2 py-1 font-mono text-[11px]">
                  {JSON.stringify(setting.value)}
                </code>
              )}

              {canManage && setting.isOverridden ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Reset to default"
                  title="Reset to the shipped default"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await resetSettingAction(setting.key as SettingKey);
                    })
                  }
                >
                  <RotateCcwIcon className="size-3.5" />
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
