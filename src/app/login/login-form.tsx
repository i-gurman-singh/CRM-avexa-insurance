'use client';

import { useActionState } from 'react';
import { AlertCircleIcon } from 'lucide-react';
import { signInAction } from '@/server/actions/auth';
import { Button, Card, CardContent, Field, Input } from '@/ui/components/primitives';
import type { ActionResult } from '@/server/action-helpers';

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState<ActionResult<null> | null, FormData>(
    signInAction,
    null,
  );

  return (
    <Card>
      <CardContent className="p-5 pt-5">
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="next" value={next ?? '/'} />

          <Field label="Email" htmlFor="email" required>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              autoFocus
              required
              placeholder="you@brokerage.com"
            />
          </Field>

          <Field label="Password" htmlFor="password" required>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••••••"
            />
          </Field>

          {state && !state.ok ? (
            <p
              className="flex items-start gap-2 rounded-md bg-critical-subtle px-3 py-2 text-xs text-critical"
              role="alert"
            >
              <AlertCircleIcon className="mt-px size-3.5 shrink-0" aria-hidden />
              {state.error}
            </p>
          ) : null}

          <Button type="submit" className="w-full" loading={pending} size="lg">
            Sign in
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
