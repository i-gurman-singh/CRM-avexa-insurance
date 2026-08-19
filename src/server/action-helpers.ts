import '@/lib/server-guard';
import { headers } from 'next/headers';
import { ZodError } from 'zod';
import { isAppError } from '@/lib/errors';
import { log } from '@/lib/logger';
import { currentActor } from '@/core/auth/session';
import type { Actor } from '@/core/context';

const logger = log('actions');

/**
 * Shared plumbing for server actions.
 *
 * Every action resolves the current user into an `Actor` (carrying IP and user
 * agent for the audit log) and converts thrown errors into a plain result the
 * form can render. Actions never leak an internal error message to the user.
 */

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function getActor(): Promise<Actor> {
  const h = await headers();
  return currentActor({
    ipAddress: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    userAgent: h.get('user-agent') ?? undefined,
  });
}

/**
 * Wrap an action body. Usage:
 *
 *   export async function createThing(input: unknown) {
 *     return action(async (actor) => service.create(actor, input));
 *   }
 */
export async function action<T>(fn: (actor: Actor) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const actor = await getActor();
    const data = await fn(actor);
    return { ok: true, data };
  } catch (e) {
    return toResult(e);
  }
}

/** Same, but for actions that do not need a signed-in user (sign-in itself). */
export async function anonymousAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return toResult(e);
  }
}

function toResult<T>(e: unknown): ActionResult<T> {
  if (e instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of e.issues) {
      const key = issue.path.join('.') || '_';
      (fieldErrors[key] ||= []).push(issue.message);
    }
    return {
      ok: false,
      error: e.issues[0]?.message ?? 'Please check the highlighted fields',
      fieldErrors,
    };
  }

  if (isAppError(e)) {
    if (!e.expose) logger.error({ err: e }, 'Action failed');
    return { ok: false, error: e.expose ? e.message : 'Something went wrong. Please try again.' };
  }

  // Next's redirect() and notFound() throw control-flow errors that must
  // propagate rather than be swallowed here.
  if (e && typeof e === 'object' && 'digest' in e && typeof e.digest === 'string') {
    if (e.digest.startsWith('NEXT_')) throw e;
  }

  logger.error({ err: e }, 'Unhandled action error');
  return { ok: false, error: 'Something went wrong. Please try again.' };
}
