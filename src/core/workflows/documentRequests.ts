import '@/lib/server-guard';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { log } from '@/lib/logger';
import { requirePermission, SYSTEM_ACTOR, type AnyActor } from '@/core/context';
import { ACTIVITY_TYPES, recordActivity } from '@/core/activity/service';
import { markRequested, outstandingItems } from '@/core/documents/checklist';
import { sendMessage } from '@/core/messaging/service';
import { getSettings } from '@/core/settings/service';
import { createSystemTask } from '@/core/tasks/service';

const logger = log('workflows:documents');

/**
 * Automatic document collection.
 *
 * The flow the brokerage asked for:
 *   customer says "I need insurance"
 *     -> CRM works out what is missing from the checklist
 *     -> CRM asks for it, in one message rather than several
 *     -> licence arrives, is detected, stored, extracted, ticked off
 *     -> ownership still missing -> CRM asks again, once, after a cooldown
 *     -> after N attempts it stops asking and creates a task for a human
 *
 * Two safety limits are non-negotiable and both are configurable:
 *   `automation.maxDocumentRequestsPerItem`  — stop nagging
 *   `automation.documentRequestCooldownHours` — don't ask twice in a day
 *
 * And the global kill switch AUTOMATION_OUTBOUND_ENABLED means the CRM will
 * draft but never send until the brokerage explicitly turns it on.
 */

export interface RequestDocumentsOptions {
  /** Ignore the cooldown (used when a human clicks "Request documents"). */
  force?: boolean;
  /** Compose the message but do not send it. */
  dryRun?: boolean;
}

export interface RequestDocumentsResult {
  requested: string[];
  skipped: Array<{ name: string; reason: string }>;
  message: string | null;
  sent: boolean;
}

export async function requestDocuments(
  actor: AnyActor,
  clientId: string,
  documentTypeIds?: string[],
  opts: RequestDocumentsOptions = {},
): Promise<RequestDocumentsResult> {
  if (actor !== SYSTEM_ACTOR) requirePermission(actor, 'messages.send');

  const settings = await getSettings([
    'automation.maxDocumentRequestsPerItem',
    'automation.documentRequestCooldownHours',
    'general.brokerageName',
  ]);

  const outstanding = await outstandingItems(clientId);
  const targets = documentTypeIds?.length
    ? outstanding.filter((i) => documentTypeIds.includes(i.documentTypeId))
    : outstanding;

  const result: RequestDocumentsResult = { requested: [], skipped: [], message: null, sent: false };
  if (!targets.length) return result;

  const cooldownMs = settings['automation.documentRequestCooldownHours'] * 3600_000;
  const maxRequests = settings['automation.maxDocumentRequestsPerItem'];
  const now = Date.now();

  const toRequest: typeof targets = [];

  for (const item of targets) {
    if (!opts.force) {
      if (item.requestCount >= maxRequests) {
        result.skipped.push({ name: item.documentType.name, reason: 'asked too many times' });
        // Hand it to a person instead of continuing to nag.
        await createSystemTask({
          clientId,
          title: `Chase ${item.documentType.name} by phone`,
          description: `The CRM asked for this ${item.requestCount} times with no result.`,
          taskTypeKey: 'call_client',
          priority: 'HIGH',
          dedupeKey: `chase-doc:${clientId}:${item.documentTypeId}`,
          createdBySystem: 'workflow:document_request',
        });
        continue;
      }

      if (item.lastRequestedAt && now - item.lastRequestedAt.getTime() < cooldownMs) {
        result.skipped.push({ name: item.documentType.name, reason: 'asked recently' });
        continue;
      }
    }

    toRequest.push(item);
  }

  if (!toRequest.length) return result;

  const message = composeRequestMessage(toRequest.map((t) => t.documentType));
  result.message = message;
  result.requested = toRequest.map((t) => t.documentType.name);

  if (opts.dryRun) return result;

  // The kill switch. When outbound automation is off, the CRM still tracks
  // that the documents are needed and creates a task, but a human sends.
  const automationAllowed = env.AUTOMATION_OUTBOUND_ENABLED || actor !== SYSTEM_ACTOR;

  if (!automationAllowed) {
    await createSystemTask({
      clientId,
      title: `Ask client for: ${result.requested.join(', ')}`,
      description: message,
      taskTypeKey: 'request_documents',
      priority: 'HIGH',
      dedupeKey: `request-docs:${clientId}:${new Date().toISOString().slice(0, 10)}`,
      createdBySystem: 'workflow:document_request',
    });
    logger.info({ clientId, documents: result.requested }, 'Outbound automation disabled; created a task instead');
    return result;
  }

  await sendMessage(actor, { clientId, text: message, isAutomated: actor === SYSTEM_ACTOR });
  result.sent = true;

  for (const item of toRequest) {
    await markRequested(clientId, item.documentTypeId);
  }

  await recordActivity({
    clientId,
    type: ACTIVITY_TYPES.DOCUMENT_REQUESTED,
    title: `Requested: ${result.requested.join(', ')}`,
    actor,
    actorType: actor === SYSTEM_ACTOR ? 'workflow' : 'user',
  });

  logger.info({ clientId, documents: result.requested }, 'Requested documents');
  return result;
}

/**
 * One message asking for everything outstanding, rather than one message per
 * document — clients find a wall of separate messages irritating.
 */
function composeRequestMessage(types: Array<{ name: string; requestTemplate: string | null }>): string {
  if (types.length === 1) {
    const type = types[0]!;
    return (
      type.requestTemplate ??
      `To move forward we'll need your ${type.name.toLowerCase()}. You can send a photo right here in this chat.`
    );
  }

  const list = types.map((t) => `• ${t.name}`).join('\n');
  return `To get your quote finalised we still need a couple of things:\n\n${list}\n\nYou can send photos of these right here in this chat.`;
}

/** Everything the client still owes us, formatted for the UI checklist. */
export async function documentChecklistSummary(clientId: string) {
  const items = await db.documentChecklistItem.findMany({
    where: { clientId },
    include: { documentType: true },
    orderBy: [{ required: 'desc' }, { documentType: { position: 'asc' } }],
  });

  return items.map((item) => ({
    id: item.id,
    name: item.documentType.name,
    documentTypeId: item.documentTypeId,
    required: item.required,
    status: item.status,
    satisfied: ['RECEIVED', 'VERIFIED', 'WAIVED'].includes(item.status),
    requestCount: item.requestCount,
    lastRequestedAt: item.lastRequestedAt,
    receivedAt: item.receivedAt,
  }));
}
