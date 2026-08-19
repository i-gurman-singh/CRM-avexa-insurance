import '@/lib/server-guard';
import { db, type DbClient } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import type { ChecklistItemStatus } from '@/lib/types';
import { ACTIVITY_TYPES, recordActivity } from '@/core/activity/service';
import { recordAudit } from '@/core/audit/service';
import { actorUserId, requirePermission, type AnyActor } from '@/core/context';

/**
 * The per-client document checklist.
 *
 * Which documents are required is a configuration question, not a code
 * question: DocumentRequirement rows say "for product X, document Y is
 * required". `ensureChecklist` reconciles a client's checklist against those
 * rules, and is safe to call repeatedly — it never resets an item that has
 * already been received.
 */

export async function ensureChecklist(clientId: string, client: DbClient = db) {
  const record = await client.client.findUnique({
    where: { id: clientId },
    select: { id: true, products: true },
  });
  if (!record) throw new NotFoundError('Client');

  const products = record.products.length ? record.products : ['auto'];

  const requirements = await client.documentRequirement.findMany({
    where: { isActive: true, productKey: { in: products } },
    include: { documentType: true },
  });

  // Fall back to document types flagged required-by-default when no explicit
  // requirement rows exist for this product yet.
  const fallback = requirements.length
    ? []
    : await client.documentType.findMany({ where: { isActive: true, requiredByDefault: true } });

  const wanted = requirements.length
    ? requirements.map((r) => ({ documentTypeId: r.documentTypeId, required: r.required }))
    : fallback.map((t) => ({ documentTypeId: t.id, required: true }));

  const existing = await client.documentChecklistItem.findMany({ where: { clientId } });
  const existingByType = new Map(existing.map((e) => [e.documentTypeId, e]));

  for (const item of wanted) {
    const current = existingByType.get(item.documentTypeId);
    if (!current) {
      await client.documentChecklistItem.create({
        data: { clientId, documentTypeId: item.documentTypeId, required: item.required },
      });
    } else if (current.required !== item.required) {
      // Requirements changed in Settings — reflect that, but never downgrade a
      // received document back to outstanding.
      await client.documentChecklistItem.update({
        where: { id: current.id },
        data: { required: item.required },
      });
    }
  }

  return listChecklist(clientId, client);
}

export async function listChecklist(clientId: string, client: DbClient = db) {
  return client.documentChecklistItem.findMany({
    where: { clientId },
    orderBy: [{ required: 'desc' }, { documentType: { position: 'asc' } }],
    include: { documentType: true, document: { select: { id: true, filename: true, receivedAt: true } } },
  });
}

/** Items we are still waiting on — drives automated requests and binding checks. */
export async function outstandingItems(clientId: string, client: DbClient = db) {
  return client.documentChecklistItem.findMany({
    where: { clientId, required: true, status: { in: ['NOT_REQUESTED', 'REQUESTED'] } },
    include: { documentType: true },
    orderBy: { documentType: { position: 'asc' } },
  });
}

export async function checklistProgress(clientId: string) {
  const items = await listChecklist(clientId);
  const required = items.filter((i) => i.required);
  const satisfied = required.filter((i) => ['RECEIVED', 'VERIFIED', 'WAIVED'].includes(i.status));
  return {
    total: required.length,
    complete: satisfied.length,
    isComplete: required.length > 0 && satisfied.length === required.length,
    items,
  };
}

/** Record that we asked the client for a document. */
export async function markRequested(
  clientId: string,
  documentTypeId: string,
  client: DbClient = db,
) {
  const item = await client.documentChecklistItem.upsert({
    where: { clientId_documentTypeId: { clientId, documentTypeId } },
    create: {
      clientId,
      documentTypeId,
      status: 'REQUESTED',
      requestedAt: new Date(),
      lastRequestedAt: new Date(),
      requestCount: 1,
    },
    update: {
      status: 'REQUESTED',
      requestedAt: new Date(),
      lastRequestedAt: new Date(),
      requestCount: { increment: 1 },
    },
    include: { documentType: true },
  });

  return item;
}

/** Attach a received document to its checklist item. */
export async function markReceived(
  clientId: string,
  documentTypeId: string,
  documentId: string,
  client: DbClient = db,
) {
  return client.documentChecklistItem.upsert({
    where: { clientId_documentTypeId: { clientId, documentTypeId } },
    create: {
      clientId,
      documentTypeId,
      status: 'RECEIVED',
      receivedAt: new Date(),
      documentId,
    },
    update: { status: 'RECEIVED', receivedAt: new Date(), documentId },
    include: { documentType: true },
  });
}

export async function setChecklistItemStatus(
  actor: AnyActor,
  itemId: string,
  status: ChecklistItemStatus,
  reason?: string,
) {
  requirePermission(actor, 'documents.verify');

  const item = await db.documentChecklistItem.update({
    where: { id: itemId },
    data: {
      status,
      ...(status === 'WAIVED'
        ? { waivedByUserId: actorUserId(actor), waivedReason: reason ?? null }
        : {}),
    },
    include: { documentType: true },
  });

  await recordActivity({
    clientId: item.clientId,
    type: 'checklist.updated',
    title: `${item.documentType.name}: ${status.toLowerCase().replace('_', ' ')}`,
    body: reason,
    actor,
  });
  await recordAudit({
    actor,
    action: 'checklist.setStatus',
    entityType: 'DocumentChecklistItem',
    entityId: itemId,
    metadata: { status, reason },
  });

  return item;
}

/** Add a one-off requirement for a single client. */
export async function addChecklistItem(
  actor: AnyActor,
  clientId: string,
  documentTypeId: string,
  required = true,
) {
  requirePermission(actor, 'documents.upload');

  const item = await db.documentChecklistItem.upsert({
    where: { clientId_documentTypeId: { clientId, documentTypeId } },
    create: { clientId, documentTypeId, required },
    update: { required },
    include: { documentType: true },
  });

  await recordActivity({
    clientId,
    type: ACTIVITY_TYPES.DOCUMENT_REQUESTED,
    title: `${item.documentType.name} added to the checklist`,
    actor,
  });
  return item;
}

export async function removeChecklistItem(actor: AnyActor, itemId: string) {
  requirePermission(actor, 'documents.upload');
  return db.documentChecklistItem.delete({ where: { id: itemId } });
}
