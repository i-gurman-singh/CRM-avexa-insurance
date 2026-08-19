import '@/lib/server-guard';
import { db } from '@/lib/db';
import { log } from '@/lib/logger';
import type { NotificationSeverity } from '@/lib/types';
import { requirePermission, type AnyActor } from '@/core/context';
import { getSetting, getSettings } from '@/core/settings/service';

const logger = log('notifications');

/**
 * In-app notifications.
 *
 * The design constraint the brokerage gave us was "do not overwhelm users".
 * Two mechanisms enforce that:
 *
 *  1. Targeting — most events go only to the assigned user, not everyone.
 *  2. Grouping — repeated events for the same client within a configurable
 *     window update the existing notification instead of stacking new ones.
 *     A client sending five photos produces one notification, not five.
 */

export interface NotifyInput {
  clientId?: string | null;
  type: string;
  title: string;
  body?: string;
  severity?: NotificationSeverity;
  linkUrl?: string;
  metadata?: Record<string, unknown>;
  /** Explicit recipients. When omitted, targeting rules below decide. */
  userIds?: string[];
  assignedUserId?: string | null;
  /** Also notify everyone with these roles. */
  alsoRoles?: Array<'ADMINISTRATOR' | 'BROKER' | 'AGENT' | 'ASSISTANT'>;
}

/** Which setting, if any, gates this notification type. */
const SETTING_FOR_TYPE: Record<string, 'notifications.notifyOnNewLead' | 'notifications.notifyOnReply' | 'notifications.notifyOnReadyToBind' | 'notifications.notifyOnAiUncertain'> = {
  'lead.new': 'notifications.notifyOnNewLead',
  'lead.quote_requested': 'notifications.notifyOnNewLead',
  'message.received': 'notifications.notifyOnReply',
  'client.ready_to_bind': 'notifications.notifyOnReadyToBind',
  'ai.uncertain': 'notifications.notifyOnAiUncertain',
};

export async function notify(input: NotifyInput): Promise<number> {
  const gate = SETTING_FOR_TYPE[input.type];
  if (gate) {
    const enabled = await getSetting(gate);
    if (!enabled) return 0;
  }

  const recipients = await resolveRecipients(input);
  if (!recipients.length) return 0;

  const groupWindowMinutes = await getSetting('notifications.digestGroupingMinutes');
  const groupKey = input.clientId ? `${input.type}:${input.clientId}` : null;
  const since = new Date(Date.now() - groupWindowMinutes * 60_000);

  let created = 0;

  for (const userId of recipients) {
    // Collapse a repeat of the same event for the same client.
    if (groupKey) {
      const existing = await db.notification.findFirst({
        where: { userId, groupKey, readAt: null, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
      });

      if (existing) {
        await db.notification.update({
          where: { id: existing.id },
          data: {
            title: input.title,
            body: input.body ?? null,
            createdAt: new Date(),
            metadata: {
              ...(existing.metadata as object),
              ...(input.metadata ?? {}),
              repeatCount: Number((existing.metadata as Record<string, unknown>)?.repeatCount ?? 1) + 1,
            } as object,
          },
        });
        continue;
      }
    }

    await db.notification.create({
      data: {
        userId,
        clientId: input.clientId ?? null,
        type: input.type,
        severity: input.severity ?? 'INFO',
        title: input.title,
        body: input.body ?? null,
        linkUrl: input.linkUrl ?? (input.clientId ? `/clients/${input.clientId}` : null),
        metadata: (input.metadata ?? {}) as object,
        groupKey,
      },
    });
    created += 1;
  }

  logger.debug({ type: input.type, recipients: recipients.length, created }, 'Notifications dispatched');
  return created;
}

/** Convenience wrapper used by the workflow engine. */
export async function notifyAboutClient(
  input: NotifyInput & { clientId: string },
): Promise<number> {
  return notify(input);
}

async function resolveRecipients(input: NotifyInput): Promise<string[]> {
  if (input.userIds?.length) return input.userIds;

  const ids = new Set<string>();

  if (input.assignedUserId) ids.add(input.assignedUserId);

  // Critical events, and events on unassigned clients, go wider.
  const needsBroadcast = !input.assignedUserId || input.severity === 'CRITICAL';
  const roles = input.alsoRoles ?? (needsBroadcast ? ['ADMINISTRATOR', 'BROKER'] : []);

  if (roles.length) {
    const users = await db.user.findMany({
      where: { isActive: true, role: { in: roles } },
      select: { id: true },
    });
    for (const u of users) ids.add(u.id);
  }

  // Absolute fallback so nothing is silently dropped in a single-user setup.
  if (!ids.size) {
    const users = await db.user.findMany({ where: { isActive: true }, select: { id: true }, take: 20 });
    for (const u of users) ids.add(u.id);
  }

  return [...ids];
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listNotifications(userId: string, opts: { unreadOnly?: boolean; take?: number } = {}) {
  return db.notification.findMany({
    where: { userId, ...(opts.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take: opts.take ?? 50,
    include: { client: { select: { id: true, displayName: true } } },
  });
}

export async function unreadNotificationCount(userId: string) {
  return db.notification.count({ where: { userId, readAt: null } });
}

export async function markNotificationRead(actor: AnyActor, notificationId: string) {
  const notification = await db.notification.findUnique({ where: { id: notificationId } });
  if (!notification || notification.userId !== ('id' in actor ? actor.id : '')) return null;
  return db.notification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
}

export async function markAllNotificationsRead(userId: string) {
  const { count } = await db.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return count;
}

/**
 * Notify about follow-ups that have come due or gone overdue.
 * Called by the periodic sweep in the worker.
 */
export async function notifyDueFollowUps(): Promise<number> {
  const settings = await getSettings(['notifications.digestGroupingMinutes']);
  void settings; // grouping is applied inside notify()

  const now = new Date();
  const dueSoon = await db.followUp.findMany({
    where: { status: 'SCHEDULED', dueAt: { lte: now } },
    include: { client: { select: { id: true, displayName: true, assignedUserId: true } } },
    take: 200,
  });

  let sent = 0;
  for (const followUp of dueSoon) {
    const overdue = now.getTime() - followUp.dueAt.getTime() > 24 * 3600_000;
    sent += await notify({
      clientId: followUp.clientId,
      type: overdue ? 'followup.overdue' : 'followup.due',
      title: overdue
        ? `Overdue follow-up: ${followUp.client.displayName}`
        : `Follow-up due: ${followUp.client.displayName}`,
      body: followUp.reason ?? undefined,
      severity: overdue ? 'WARNING' : 'INFO',
      assignedUserId: followUp.assignedUserId ?? followUp.client.assignedUserId,
      linkUrl: `/clients/${followUp.clientId}`,
    });
  }

  return sent;
}

export async function deleteNotification(actor: AnyActor, notificationId: string) {
  requirePermission(actor, 'clients.view');
  return db.notification.delete({ where: { id: notificationId } });
}
