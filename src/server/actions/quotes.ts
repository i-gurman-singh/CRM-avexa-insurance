'use server';

import { revalidatePath } from 'next/cache';
import {
  createQuote,
  deleteQuote,
  markQuoteSent,
  selectQuote,
  updateQuote,
} from '@/core/quotes/service';
import { bindPolicy, cancelPolicy, createPolicy, updatePolicy } from '@/core/policies/service';
import { action } from '@/server/action-helpers';

/** Quotes and policies. */

function revalidateClient(clientId: string) {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/policies');
  revalidatePath('/');
}

export async function createQuoteAction(clientId: string, input: unknown) {
  return action(async (actor) => {
    const quote = await createQuote(actor, clientId, input);
    revalidateClient(clientId);
    return { id: quote.id };
  });
}

export async function updateQuoteAction(clientId: string, quoteId: string, input: unknown) {
  return action(async (actor) => {
    await updateQuote(actor, quoteId, input);
    revalidateClient(clientId);
  });
}

export async function markQuoteSentAction(clientId: string, quoteId: string) {
  return action(async (actor) => {
    await markQuoteSent(actor, quoteId);
    revalidateClient(clientId);
  });
}

export async function selectQuoteAction(clientId: string, quoteId: string) {
  return action(async (actor) => {
    await selectQuote(actor, quoteId);
    revalidateClient(clientId);
  });
}

export async function deleteQuoteAction(clientId: string, quoteId: string) {
  return action(async (actor) => {
    await deleteQuote(actor, quoteId);
    revalidateClient(clientId);
  });
}

// --- Policies --------------------------------------------------------------

export async function createPolicyAction(clientId: string, input: unknown) {
  return action(async (actor) => {
    const policy = await createPolicy(actor, clientId, input);
    revalidateClient(clientId);
    return { id: policy.id };
  });
}

export async function updatePolicyAction(clientId: string, policyId: string, input: unknown) {
  return action(async (actor) => {
    await updatePolicy(actor, policyId, input);
    revalidateClient(clientId);
  });
}

/**
 * Bind a policy. The service refuses automation actors and enforces the
 * `policies.bind` permission and the outstanding-documents check; the override
 * flag exists so a broker can proceed knowingly, and it is recorded.
 */
export async function bindPolicyAction(
  clientId: string,
  policyId: string,
  opts: { overrideMissingDocuments?: boolean; overrideReason?: string } = {},
) {
  return action(async (actor) => {
    await bindPolicy(actor, policyId, opts);
    revalidateClient(clientId);
  });
}

export async function cancelPolicyAction(clientId: string, policyId: string, reason: string) {
  return action(async (actor) => {
    await cancelPolicy(actor, policyId, reason);
    revalidateClient(clientId);
  });
}
