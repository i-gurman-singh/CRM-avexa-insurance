'use server';

import { revalidatePath } from 'next/cache';
import type { ChecklistItemStatus, DocumentVerificationStatus } from '@/lib/types';
import {
  deleteDocument,
  reprocessDocument,
  setDocumentType,
  uploadDocument,
  verifyDocument,
} from '@/core/documents/service';
import {
  addChecklistItem,
  removeChecklistItem,
  setChecklistItemStatus,
} from '@/core/documents/checklist';
import { applyExtraction } from '@/core/documents/apply';
import { acceptSuggestion, rejectSuggestion } from '@/core/ai/suggestions';
import { action } from '@/server/action-helpers';

/** Documents, the checklist, and the AI suggestion queue. */

function revalidateDocuments(clientId?: string) {
  revalidatePath('/documents');
  revalidatePath('/suggestions');
  revalidatePath('/');
  if (clientId) revalidatePath(`/clients/${clientId}`);
}

export async function uploadDocumentAction(clientId: string, formData: FormData) {
  return action(async (actor) => {
    const file = formData.get('file');
    if (!(file instanceof File)) throw new Error('No file was provided');

    const documentTypeId = formData.get('documentTypeId');
    const buffer = Buffer.from(await file.arrayBuffer());

    const result = await uploadDocument(
      actor,
      clientId,
      { body: buffer, filename: file.name, mimeType: file.type || 'application/octet-stream' },
      typeof documentTypeId === 'string' && documentTypeId ? documentTypeId : null,
    );

    revalidateDocuments(clientId);
    return { id: result.document.id, duplicate: result.isDuplicate };
  });
}

export async function setDocumentTypeAction(
  clientId: string,
  documentId: string,
  documentTypeId: string | null,
) {
  return action(async (actor) => {
    await setDocumentType(actor, documentId, documentTypeId);
    revalidateDocuments(clientId);
  });
}

export async function verifyDocumentAction(
  clientId: string,
  documentId: string,
  status: DocumentVerificationStatus,
  rejectionReason?: string,
) {
  return action(async (actor) => {
    await verifyDocument(actor, documentId, status, rejectionReason);
    revalidateDocuments(clientId);
  });
}

export async function deleteDocumentAction(clientId: string, documentId: string) {
  return action(async (actor) => {
    await deleteDocument(actor, documentId);
    revalidateDocuments(clientId);
  });
}

export async function reprocessDocumentAction(clientId: string, documentId: string) {
  return action(async (actor) => {
    await reprocessDocument(actor, documentId);
    revalidateDocuments(clientId);
  });
}

/**
 * Accept every value from an extraction into the client record.
 * `humanApproved` bypasses the overwrite guard and marks the values verified —
 * which is exactly what a person clicking "accept all" means.
 */
export async function applyExtractionAction(
  clientId: string,
  documentId: string,
  extractionId: string,
  opts: { driverId?: string | null; vehicleId?: string | null } = {},
) {
  return action(async (actor) => {
    const result = await applyExtraction(actor, documentId, extractionId, {
      ...opts,
      humanApproved: true,
    });
    revalidateDocuments(clientId);
    return result;
  });
}

// --- Checklist -------------------------------------------------------------

export async function setChecklistStatusAction(
  clientId: string,
  itemId: string,
  status: ChecklistItemStatus,
  reason?: string,
) {
  return action(async (actor) => {
    await setChecklistItemStatus(actor, itemId, status, reason);
    revalidateDocuments(clientId);
  });
}

export async function addChecklistItemAction(
  clientId: string,
  documentTypeId: string,
  required = true,
) {
  return action(async (actor) => {
    await addChecklistItem(actor, clientId, documentTypeId, required);
    revalidateDocuments(clientId);
  });
}

export async function removeChecklistItemAction(clientId: string, itemId: string) {
  return action(async (actor) => {
    await removeChecklistItem(actor, itemId);
    revalidateDocuments(clientId);
  });
}

// --- AI suggestions --------------------------------------------------------

export async function acceptSuggestionAction(suggestionId: string, notes?: string) {
  return action(async (actor) => {
    const suggestion = await acceptSuggestion(actor, suggestionId, notes);
    revalidateDocuments(suggestion?.clientId);
    revalidatePath('/pipeline');
  });
}

export async function rejectSuggestionAction(suggestionId: string, notes?: string) {
  return action(async (actor) => {
    const suggestion = await rejectSuggestion(actor, suggestionId, notes);
    revalidateDocuments(suggestion.clientId);
  });
}
