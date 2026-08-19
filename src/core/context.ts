import type { UserRole } from '@/lib/types';
import { ForbiddenError, UnauthorizedError } from '@/lib/errors';
import { can, type Permission, type PermissionSubject } from '@/lib/rbac';

/**
 * Who is performing an action.
 *
 * Every core service takes an `Actor` rather than reading a session directly,
 * which keeps business logic independent of the web framework and makes the
 * services trivially testable and callable from the background worker.
 */
export interface Actor extends PermissionSubject {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  permissionOverrides?: Record<string, boolean> | null;
  /** Request metadata, recorded in the audit log when present. */
  ipAddress?: string;
  userAgent?: string;
}

/**
 * The CRM acting on its own behalf: the background worker, the webhook
 * handler, a workflow rule. Has no permissions of its own — services that
 * accept a SystemActor must explicitly allow it.
 */
export const SYSTEM_ACTOR = {
  id: 'system',
  name: 'CRM Automation',
  email: 'system@internal',
  role: 'ADMINISTRATOR' as UserRole,
  isSystem: true as const,
};

export type SystemActor = typeof SYSTEM_ACTOR;
export type AnyActor = Actor | SystemActor;

export function isSystemActor(actor: AnyActor): actor is SystemActor {
  return (actor as SystemActor).isSystem === true;
}

/** Throws unless the actor holds the permission. System actor always passes. */
export function requirePermission(actor: AnyActor | null | undefined, permission: Permission): asserts actor is AnyActor {
  if (!actor) throw new UnauthorizedError();
  if (isSystemActor(actor)) return;
  if (!can(actor, permission)) {
    throw new ForbiddenError(`Missing permission: ${permission}`);
  }
}

/** Non-throwing variant for conditional UI. */
export function actorCan(actor: AnyActor | null | undefined, permission: Permission): boolean {
  if (!actor) return false;
  if (isSystemActor(actor)) return true;
  return can(actor, permission);
}

/** Actor id suitable for a nullable `userId` foreign key. */
export function actorUserId(actor: AnyActor): string | null {
  return isSystemActor(actor) ? null : actor.id;
}

/** "user" | "system" — used by the activity timeline. */
export function actorType(actor: AnyActor): 'user' | 'system' {
  return isSystemActor(actor) ? 'system' : 'user';
}
