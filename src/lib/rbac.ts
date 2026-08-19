import type { UserRole } from '@/lib/types';

/**
 * Permission model.
 *
 * Permissions are strings namespaced `resource.action`. Roles map to a set of
 * permissions; individual users can be granted or denied specific permissions
 * on top of their role (User.permissionOverrides).
 *
 * To add a capability later: add the string to PERMISSIONS, grant it in
 * ROLE_PERMISSIONS, and guard the call site with `requirePermission`. No other
 * part of the app needs to change.
 */

export const PERMISSIONS = [
  'clients.view',
  'clients.create',
  'clients.update',
  'clients.delete',
  'clients.viewAll', // vs only clients assigned to me
  'clients.assign',

  'pipeline.move',

  'quotes.view',
  'quotes.create',
  'quotes.update',
  'quotes.delete',
  'quotes.select',

  'policies.view',
  'policies.create',
  'policies.update',
  'policies.bind', // the regulated action — deliberately narrow

  'documents.view',
  'documents.download',
  'documents.upload',
  'documents.delete',
  'documents.verify',

  'messages.view',
  'messages.send',
  'messages.sendTemplate',

  'tasks.view',
  'tasks.create',
  'tasks.update',
  'tasks.delete',
  'tasks.assign',

  'followups.view',
  'followups.create',
  'followups.update',
  'followups.delete',

  'notes.view',
  'notes.create',
  'notes.delete',

  'ai.reviewSuggestions',
  'ai.applySuggestions',
  'ai.reprocess',

  'analytics.view',
  'analytics.viewRevenue',

  'settings.view',
  'settings.manage',

  'users.view',
  'users.manage',

  'audit.view',
  'jobs.view',
  'jobs.retry',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

const BROKER: Permission[] = [
  'clients.view',
  'clients.create',
  'clients.update',
  'clients.viewAll',
  'clients.assign',
  'pipeline.move',
  'quotes.view',
  'quotes.create',
  'quotes.update',
  'quotes.delete',
  'quotes.select',
  'policies.view',
  'policies.create',
  'policies.update',
  'policies.bind',
  'documents.view',
  'documents.download',
  'documents.upload',
  'documents.verify',
  'messages.view',
  'messages.send',
  'messages.sendTemplate',
  'tasks.view',
  'tasks.create',
  'tasks.update',
  'tasks.delete',
  'tasks.assign',
  'followups.view',
  'followups.create',
  'followups.update',
  'followups.delete',
  'notes.view',
  'notes.create',
  'notes.delete',
  'ai.reviewSuggestions',
  'ai.applySuggestions',
  'ai.reprocess',
  'analytics.view',
  'analytics.viewRevenue',
  'settings.view',
  'jobs.view',
];

const AGENT: Permission[] = [
  'clients.view',
  'clients.create',
  'clients.update',
  'clients.viewAll',
  'pipeline.move',
  'quotes.view',
  'quotes.create',
  'quotes.update',
  'quotes.select',
  'policies.view',
  'policies.create',
  'policies.update',
  // Note: no 'policies.bind' — binding stays with brokers/admins.
  'documents.view',
  'documents.download',
  'documents.upload',
  'documents.verify',
  'messages.view',
  'messages.send',
  'tasks.view',
  'tasks.create',
  'tasks.update',
  'tasks.assign',
  'followups.view',
  'followups.create',
  'followups.update',
  'notes.view',
  'notes.create',
  'ai.reviewSuggestions',
  'ai.applySuggestions',
  'analytics.view',
];

const ASSISTANT: Permission[] = [
  'clients.view',
  'clients.create',
  'clients.update',
  'clients.viewAll',
  'pipeline.move',
  'quotes.view',
  'policies.view',
  'documents.view',
  'documents.upload',
  // Deliberately no 'documents.download' — assistants can see that a licence
  // exists and its extracted summary, but not pull the raw image.
  'messages.view',
  'messages.send',
  'tasks.view',
  'tasks.create',
  'tasks.update',
  'followups.view',
  'followups.create',
  'followups.update',
  'notes.view',
  'notes.create',
  'ai.reviewSuggestions',
];

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  ADMINISTRATOR: ALL,
  BROKER,
  AGENT,
  ASSISTANT,
};

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMINISTRATOR: 'Administrator',
  BROKER: 'Broker',
  AGENT: 'Agent',
  ASSISTANT: 'Assistant',
};

export interface PermissionSubject {
  role: UserRole;
  permissionOverrides?: Record<string, boolean> | null;
}

/** Resolve the effective permission set for a user. */
export function permissionsFor(subject: PermissionSubject): Set<Permission> {
  const set = new Set<Permission>(ROLE_PERMISSIONS[subject.role] ?? []);
  const overrides = subject.permissionOverrides ?? {};
  for (const [key, allowed] of Object.entries(overrides)) {
    const perm = key as Permission;
    if (!PERMISSIONS.includes(perm)) continue;
    if (allowed) set.add(perm);
    else set.delete(perm);
  }
  return set;
}

export function can(subject: PermissionSubject, permission: Permission): boolean {
  return permissionsFor(subject).has(permission);
}

export function canAny(subject: PermissionSubject, permissions: Permission[]): boolean {
  const set = permissionsFor(subject);
  return permissions.some((p) => set.has(p));
}

/**
 * Actions that must always have a human behind them. Automation checks this
 * list before acting; anything here becomes a suggestion instead.
 */
export const HUMAN_ONLY_ACTIONS = [
  'policies.bind',
  'quotes.select',
  'coverage.decision',
  'underwriting.decision',
  'pricing.commitment',
  'client.identityFieldOverwrite',
] as const;

export type HumanOnlyAction = (typeof HUMAN_ONLY_ACTIONS)[number];

export function requiresHumanApproval(action: string): boolean {
  return (HUMAN_ONLY_ACTIONS as readonly string[]).includes(action);
}
