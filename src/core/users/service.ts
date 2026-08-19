import '@/lib/server-guard';
import { z } from 'zod';
import { db } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import type { UserRole } from '@/lib/types';
import { PERMISSIONS, type Permission } from '@/lib/rbac';
import { recordAudit } from '@/core/audit/service';
import { requirePermission, type AnyActor } from '@/core/context';
import { checkPasswordStrength, hashPassword } from '@/core/auth/passwords';

/**
 * User administration.
 *
 * Roles are coarse (Administrator / Broker / Agent / Assistant) with per-user
 * overrides for the exceptions, which in a small brokerage is almost always
 * what you want — one assistant who is trusted with document downloads, one
 * agent who is allowed to bind. Adding a whole new role is a code change;
 * adding an exception is not.
 */

export const userCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
  role: z.enum(['ADMINISTRATOR', 'BROKER', 'AGENT', 'ASSISTANT']).default('AGENT'),
  phone: z.string().trim().max(40).optional().nullable(),
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  role: z.enum(['ADMINISTRATOR', 'BROKER', 'AGENT', 'ASSISTANT']).optional(),
  phone: z.string().trim().max(40).optional().nullable(),
  isActive: z.boolean().optional(),
  avatarUrl: z.string().trim().url().optional().nullable(),
});

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  phone: true,
  avatarUrl: true,
  isActive: true,
  lastLoginAt: true,
  permissionOverrides: true,
  createdAt: true,
} as const;

export async function listUsers(opts: { includeInactive?: boolean } = {}) {
  return db.user.findMany({
    where: opts.includeInactive ? {} : { isActive: true },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: userSelect,
  });
}

/** Lightweight list for assignee pickers. */
export async function listAssignableUsers() {
  return db.user.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, avatarUrl: true, role: true },
  });
}

export async function getUser(id: string) {
  return db.user.findUnique({ where: { id }, select: userSelect });
}

export async function createUser(actor: AnyActor, rawInput: unknown) {
  requirePermission(actor, 'users.manage');
  const input = userCreateSchema.parse(rawInput);

  const strength = checkPasswordStrength(input.password);
  if (!strength.ok) throw new ValidationError('Password is not strong enough', strength.problems);

  const existing = await db.user.findUnique({ where: { email: input.email } });
  if (existing) throw new ConflictError('A user with that email already exists');

  const user = await db.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      role: input.role,
      phone: input.phone ?? null,
    },
    select: userSelect,
  });

  await recordAudit({
    actor,
    action: 'user.create',
    entityType: 'User',
    entityId: user.id,
    metadata: { email: input.email, role: input.role },
  });

  return user;
}

export async function updateUser(actor: AnyActor, id: string, rawInput: unknown) {
  requirePermission(actor, 'users.manage');
  const input = userUpdateSchema.parse(rawInput);

  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('User');

  // Guard against locking everyone out of administration.
  if ((input.role && input.role !== 'ADMINISTRATOR') || input.isActive === false) {
    if (existing.role === 'ADMINISTRATOR') {
      const others = await db.user.count({
        where: { role: 'ADMINISTRATOR', isActive: true, id: { not: id } },
      });
      if (others === 0) {
        throw new ConflictError('This is the last active administrator. Promote someone else first.');
      }
    }
  }

  const user = await db.user.update({ where: { id }, data: input, select: userSelect });

  await recordAudit({
    actor,
    action: 'user.update',
    entityType: 'User',
    entityId: id,
    metadata: { ...input },
  });

  return user;
}

export async function setUserPassword(actor: AnyActor, id: string, password: string) {
  requirePermission(actor, 'users.manage');

  const strength = checkPasswordStrength(password);
  if (!strength.ok) throw new ValidationError('Password is not strong enough', strength.problems);

  await db.user.update({ where: { id }, data: { passwordHash: await hashPassword(password) } });
  await recordAudit({ actor, action: 'user.setPassword', entityType: 'User', entityId: id });
}

/** A user changing their own password; requires the current one. */
export async function changeOwnPassword(
  actor: AnyActor,
  currentPassword: string,
  newPassword: string,
) {
  if (!('id' in actor)) throw new NotFoundError('User');

  const { verifyPassword } = await import('@/core/auth/passwords');
  const user = await db.user.findUnique({ where: { id: actor.id } });
  if (!user) throw new NotFoundError('User');

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) throw new ValidationError('Your current password is not correct');

  const strength = checkPasswordStrength(newPassword);
  if (!strength.ok) throw new ValidationError('Password is not strong enough', strength.problems);

  await db.user.update({
    where: { id: actor.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  await recordAudit({ actor, action: 'user.changeOwnPassword', entityType: 'User', entityId: actor.id });
}

/** Grant or revoke a single permission for one user, on top of their role. */
export async function setPermissionOverride(
  actor: AnyActor,
  id: string,
  permission: Permission,
  allowed: boolean | null,
) {
  requirePermission(actor, 'users.manage');
  if (!PERMISSIONS.includes(permission)) throw new ValidationError('Unknown permission');

  const user = await db.user.findUnique({ where: { id } });
  if (!user) throw new NotFoundError('User');

  const overrides = { ...((user.permissionOverrides ?? {}) as Record<string, boolean>) };
  if (allowed === null) delete overrides[permission];
  else overrides[permission] = allowed;

  const updated = await db.user.update({
    where: { id },
    data: { permissionOverrides: overrides as object },
    select: userSelect,
  });

  await recordAudit({
    actor,
    action: 'user.setPermissionOverride',
    entityType: 'User',
    entityId: id,
    metadata: { permission, allowed },
  });

  return updated;
}

export async function deactivateUser(actor: AnyActor, id: string) {
  return updateUser(actor, id, { isActive: false });
}

export const ROLE_OPTIONS: Array<{ value: UserRole; label: string; description: string }> = [
  {
    value: 'ADMINISTRATOR',
    label: 'Administrator',
    description: 'Full access, including settings, users and audit logs.',
  },
  {
    value: 'BROKER',
    label: 'Broker',
    description: 'Everything client-facing, including binding policies and revenue analytics.',
  },
  {
    value: 'AGENT',
    label: 'Agent',
    description: 'Full client, quote and document work. Cannot bind policies.',
  },
  {
    value: 'ASSISTANT',
    label: 'Assistant',
    description: 'Data entry and messaging. Cannot download documents or see revenue.',
  },
];
