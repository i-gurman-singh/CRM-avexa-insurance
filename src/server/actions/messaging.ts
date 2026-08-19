'use server';

import { revalidatePath } from 'next/cache';
import type { ConversationState, Priority } from '@/lib/types';
import {
  markConversationRead,
  sendMessage,
  sendTemplate,
  setConversationPriority,
  setConversationState,
  toggleConversationPin,
} from '@/core/messaging/service';
import { requestDocuments } from '@/core/workflows/documentRequests';
import { action } from '@/server/action-helpers';

/** WhatsApp conversation actions. */

function revalidateConversation(clientId: string) {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/conversations');
  revalidatePath('/');
}

export async function sendMessageAction(clientId: string, text: string) {
  return action(async (actor) => {
    const message = await sendMessage(actor, { clientId, text });
    revalidateConversation(clientId);
    return { id: message.id };
  });
}

export async function sendTemplateAction(
  clientId: string,
  templateName: string,
  variables: string[] = [],
) {
  return action(async (actor) => {
    await sendTemplate(actor, clientId, templateName, variables);
    revalidateConversation(clientId);
  });
}

export async function markReadAction(clientId: string, conversationId: string) {
  return action(async (actor) => {
    await markConversationRead(actor, conversationId);
    revalidateConversation(clientId);
  });
}

export async function setConversationStateAction(
  clientId: string,
  conversationId: string,
  state: ConversationState,
) {
  return action(async (actor) => {
    await setConversationState(actor, conversationId, state);
    revalidateConversation(clientId);
  });
}

export async function setConversationPriorityAction(
  clientId: string,
  conversationId: string,
  priority: Priority,
) {
  return action(async (actor) => {
    await setConversationPriority(actor, conversationId, priority);
    revalidateConversation(clientId);
  });
}

export async function togglePinAction(clientId: string, conversationId: string, isPinned: boolean) {
  return action(async (actor) => {
    await toggleConversationPin(actor, conversationId, isPinned);
    revalidateConversation(clientId);
  });
}

/**
 * Ask the client for outstanding documents.
 * A person clicking this counts as approval, so the cooldown is bypassed.
 */
export async function requestDocumentsAction(clientId: string, documentTypeIds?: string[]) {
  return action(async (actor) => {
    const result = await requestDocuments(actor, clientId, documentTypeIds, { force: true });
    revalidateConversation(clientId);
    return result;
  });
}

/** Preview the message without sending it. */
export async function previewDocumentRequestAction(clientId: string, documentTypeIds?: string[]) {
  return action(async (actor) =>
    requestDocuments(actor, clientId, documentTypeIds, { force: true, dryRun: true }),
  );
}
