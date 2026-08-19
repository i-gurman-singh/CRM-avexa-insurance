import '@/lib/server-guard';
import { createHash } from 'node:crypto';
import { db, type DbClient } from '@/lib/db';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { log } from '@/lib/logger';
import type { DocumentVerificationStatus, Prisma } from '@/lib/types';
import { buildDocumentKey, getStorage } from '@/integrations/storage';
import { enqueue, JOB_TYPES } from '@/integrations/queue';
import { ACTIVITY_TYPES, recordActivity } from '@/core/activity/service';
import { recordAudit } from '@/core/audit/service';
import { actorUserId, requirePermission, type AnyActor } from '@/core/context';
import { markReceived } from './checklist';

const logger = log('documents');

/**
 * Document storage.
 *
 * Files are always private. The database holds only a storage key; the bytes
 * live in S3 (or the local filesystem in development). Downloads go through
 * `getDownloadUrl`, which checks permissions, writes an audit entry, and then
 * mints a short-lived signed URL. There is no code path that produces a
 * permanent public link.
 */

export const documentInclude = {
  documentType: true,
  verifiedByUser: { select: { id: true, name: true } },
  extractions: { orderBy: { createdAt: 'desc' as const }, take: 1 },
} satisfies Prisma.DocumentInclude;

export interface StoreDocumentInput {
  clientId: string;
  body: Buffer;
  filename: string;
  mimeType: string;
  source?: 'whatsapp' | 'upload' | 'email' | 'generated';
  messageId?: string | null;
  attachmentId?: string | null;
  documentTypeId?: string | null;
  uploadedByUserId?: string | null;
  /** Skip AI analysis (e.g. for documents we generated ourselves). */
  skipProcessing?: boolean;
}

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/**
 * Persist a document: row first, then bytes, then queue analysis.
 *
 * The row is created before the upload so that a storage failure leaves a
 * visible, retryable record rather than a silently lost client document.
 */
export async function storeDocument(input: StoreDocumentInput, client: DbClient = db) {
  if (input.body.length === 0) throw new ConflictError('That file is empty');
  if (input.body.length > MAX_DOCUMENT_BYTES) {
    throw new ConflictError('That file is larger than the 25 MB limit');
  }

  const sha256 = createHash('sha256').update(input.body).digest('hex');

  // Re-sending the same file (very common on WhatsApp) should not create a
  // duplicate document.
  const duplicate = await client.document.findFirst({
    where: { clientId: input.clientId, sha256 },
    include: documentInclude,
  });
  if (duplicate) {
    logger.info({ clientId: input.clientId, documentId: duplicate.id }, 'Duplicate document ignored');
    return { document: duplicate, isDuplicate: true as const };
  }

  const created = await client.document.create({
    data: {
      clientId: input.clientId,
      documentTypeId: input.documentTypeId ?? null,
      messageId: input.messageId ?? null,
      attachmentId: input.attachmentId ?? null,
      source: input.source ?? 'whatsapp',
      uploadedByUserId: input.uploadedByUserId ?? null,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.body.length,
      storageKey: 'pending',
      sha256,
      processingStatus: input.skipProcessing ? 'SKIPPED' : 'PENDING',
    },
  });

  const storageKey = buildDocumentKey(input.clientId, created.id, input.filename);

  try {
    await getStorage().put({
      key: storageKey,
      body: input.body,
      contentType: input.mimeType,
      metadata: { clientId: input.clientId, documentId: created.id },
    });
  } catch (e) {
    await client.document.update({
      where: { id: created.id },
      data: { processingStatus: 'FAILED', notes: 'Upload to storage failed' },
    });
    throw e;
  }

  const document = await client.document.update({
    where: { id: created.id },
    data: { storageKey },
    include: documentInclude,
  });

  if (input.attachmentId) {
    await client.messageAttachment.update({
      where: { id: input.attachmentId },
      data: { storageKey, sha256, downloadStatus: 'PROCESSED' },
    });
  }

  await recordActivity(
    {
      clientId: input.clientId,
      type: ACTIVITY_TYPES.DOCUMENT_RECEIVED,
      title: `Document received: ${input.filename}`,
      metadata: { source: input.source ?? 'whatsapp', sizeBytes: input.body.length },
      actor: { id: 'system', name: 'CRM', email: 'system@internal', role: 'ADMINISTRATOR', isSystem: true } as never,
      actorType: input.source === 'whatsapp' ? 'client' : 'user',
      entityType: 'Document',
      entityId: document.id,
    },
    client,
  );

  if (!input.skipProcessing) {
    await enqueue(JOB_TYPES.PROCESS_DOCUMENT, { documentId: document.id }, {
      dedupeKey: `process-document:${document.id}`,
    });
  }

  return { document, isDuplicate: false as const };
}

/** Manual upload from the CRM UI. */
export async function uploadDocument(
  actor: AnyActor,
  clientId: string,
  file: { body: Buffer; filename: string; mimeType: string },
  documentTypeId?: string | null,
) {
  requirePermission(actor, 'documents.upload');

  const result = await storeDocument({
    clientId,
    body: file.body,
    filename: file.filename,
    mimeType: file.mimeType,
    source: 'upload',
    documentTypeId: documentTypeId ?? null,
    uploadedByUserId: actorUserId(actor),
  });

  if (documentTypeId) {
    await markReceived(clientId, documentTypeId, result.document.id);
  }

  await recordAudit({
    actor,
    action: 'document.upload',
    entityType: 'Document',
    entityId: result.document.id,
    metadata: { clientId, filename: file.filename },
  });

  return result;
}

export async function listDocuments(clientId: string) {
  return db.document.findMany({
    where: { clientId },
    orderBy: { receivedAt: 'desc' },
    include: documentInclude,
  });
}

export async function getDocument(id: string) {
  return db.document.findUnique({
    where: { id },
    include: {
      ...documentInclude,
      client: { select: { id: true, displayName: true, phone: true } },
      extractions: { orderBy: { createdAt: 'desc' } },
    },
  });
}

/**
 * Mint a short-lived download URL.
 *
 * Every call is audited — for sensitive personal documents, knowing who looked
 * at what and when is as important as controlling who can.
 */
export async function getDownloadUrl(actor: AnyActor, documentId: string): Promise<string> {
  requirePermission(actor, 'documents.download');

  const document = await db.document.findUnique({ where: { id: documentId } });
  if (!document) throw new NotFoundError('Document');

  const url = await getStorage().getSignedUrl(document.storageKey, {
    downloadFilename: document.filename,
  });

  await recordAudit({
    actor,
    action: 'document.download',
    entityType: 'Document',
    entityId: documentId,
    metadata: { clientId: document.clientId, filename: document.filename },
  });

  return url;
}

/** Stream bytes server-side, for inline previews. Also audited. */
export async function readDocument(actor: AnyActor, documentId: string) {
  requirePermission(actor, 'documents.download');

  const document = await db.document.findUnique({ where: { id: documentId } });
  if (!document) throw new NotFoundError('Document');

  const object = await getStorage().get(document.storageKey);

  await recordAudit({
    actor,
    action: 'document.view',
    entityType: 'Document',
    entityId: documentId,
    metadata: { clientId: document.clientId },
  });

  return { document, object };
}

export async function setDocumentType(actor: AnyActor, documentId: string, documentTypeId: string | null) {
  requirePermission(actor, 'documents.verify');

  const document = await db.document.update({
    where: { id: documentId },
    data: { documentTypeId },
    include: documentInclude,
  });

  if (documentTypeId) {
    await markReceived(document.clientId, documentTypeId, document.id);
  }

  await recordAudit({
    actor,
    action: 'document.setType',
    entityType: 'Document',
    entityId: documentId,
    metadata: { documentTypeId },
  });

  return document;
}

export async function verifyDocument(
  actor: AnyActor,
  documentId: string,
  status: DocumentVerificationStatus,
  rejectionReason?: string,
) {
  requirePermission(actor, 'documents.verify');

  const document = await db.document.update({
    where: { id: documentId },
    data: {
      verificationStatus: status,
      verifiedByUserId: actorUserId(actor),
      verifiedAt: new Date(),
      rejectionReason: status === 'REJECTED' ? (rejectionReason ?? null) : null,
    },
    include: documentInclude,
  });

  if (status === 'VERIFIED' && document.documentTypeId) {
    await db.documentChecklistItem.updateMany({
      where: { clientId: document.clientId, documentTypeId: document.documentTypeId },
      data: { status: 'VERIFIED' },
    });
  }

  await recordActivity({
    clientId: document.clientId,
    type: status === 'VERIFIED' ? ACTIVITY_TYPES.DOCUMENT_VERIFIED : ACTIVITY_TYPES.DOCUMENT_REJECTED,
    title:
      status === 'VERIFIED'
        ? `Document verified: ${document.filename}`
        : `Document rejected: ${document.filename}`,
    body: rejectionReason,
    actor,
    entityType: 'Document',
    entityId: documentId,
  });

  await recordAudit({
    actor,
    action: 'document.verify',
    entityType: 'Document',
    entityId: documentId,
    metadata: { status, rejectionReason },
  });

  return document;
}

export async function deleteDocument(actor: AnyActor, documentId: string) {
  requirePermission(actor, 'documents.delete');

  const document = await db.document.findUnique({ where: { id: documentId } });
  if (!document) throw new NotFoundError('Document');

  await db.document.delete({ where: { id: documentId } });

  // Remove the object last: an orphaned row is worse than an orphaned object.
  try {
    await getStorage().delete(document.storageKey);
  } catch (e) {
    logger.error({ err: e, storageKey: document.storageKey }, 'Failed to delete stored object');
  }

  await recordAudit({
    actor,
    action: 'document.delete',
    entityType: 'Document',
    entityId: documentId,
    metadata: { clientId: document.clientId, filename: document.filename },
  });

  return document;
}

/** Documents waiting for a human to check the AI's reading. */
export async function listPendingVerification(take = 50) {
  return db.document.findMany({
    where: {
      verificationStatus: 'UNVERIFIED',
      processingStatus: 'PROCESSED',
    },
    orderBy: { receivedAt: 'desc' },
    take,
    include: {
      ...documentInclude,
      client: { select: { id: true, displayName: true, phone: true } },
    },
  });
}

/** Re-run AI analysis on a document. */
export async function reprocessDocument(actor: AnyActor, documentId: string) {
  requirePermission(actor, 'ai.reprocess');
  await db.document.update({ where: { id: documentId }, data: { processingStatus: 'PENDING' } });
  await enqueue(JOB_TYPES.PROCESS_DOCUMENT, { documentId, force: true });
  await recordAudit({ actor, action: 'document.reprocess', entityType: 'Document', entityId: documentId });
}
