'use server';

import { revalidatePath } from 'next/cache';
import {
  addClaim,
  addConviction,
  addDriver,
  addNote,
  addVehicle,
  archiveClient,
  assignClient,
  createClient,
  deleteClaim,
  deleteConviction,
  deleteDriver,
  deleteNote,
  deleteVehicle,
  toggleNotePin,
  updateClient,
  updateDriver,
  updateVehicle,
} from '@/core/clients/service';
import { verifyFields } from '@/core/clients/provenance';
import { moveClientToStage } from '@/core/pipeline/service';
import { ensureChecklist } from '@/core/documents/checklist';
import { action } from '@/server/action-helpers';

/**
 * Client server actions.
 *
 * Thin wrappers: resolve the actor, call the service, revalidate the affected
 * routes. All validation and business logic lives in `@/core/clients` so the
 * same operations are available to the API, the worker and tests.
 */

function revalidateClient(clientId: string) {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/clients');
  revalidatePath('/pipeline');
}

export async function createClientAction(input: unknown) {
  return action(async (actor) => {
    const client = await createClient(actor, input);
    await ensureChecklist(client.id);
    revalidatePath('/clients');
    revalidatePath('/pipeline');
    return { id: client.id };
  });
}

export async function updateClientAction(clientId: string, input: unknown) {
  return action(async (actor) => {
    await updateClient(actor, clientId, input);
    revalidateClient(clientId);
  });
}

export async function moveStageAction(
  clientId: string,
  toStageId: string,
  opts: { lostReasonId?: string | null; lostNotes?: string | null; reason?: string } = {},
) {
  return action(async (actor) => {
    await moveClientToStage(actor, {
      clientId,
      toStageId,
      changedBy: 'manual',
      reason: opts.reason,
      lostReasonId: opts.lostReasonId,
      lostNotes: opts.lostNotes,
    });
    revalidateClient(clientId);
    revalidatePath('/');
  });
}

export async function assignClientAction(clientId: string, userId: string | null) {
  return action(async (actor) => {
    await assignClient(actor, clientId, userId);
    revalidateClient(clientId);
  });
}

export async function archiveClientAction(clientId: string, archived: boolean) {
  return action(async (actor) => {
    await archiveClient(actor, clientId, archived);
    revalidateClient(clientId);
  });
}

// --- Drivers ---------------------------------------------------------------

export async function addDriverAction(clientId: string, input: unknown) {
  return action(async (actor) => {
    const driver = await addDriver(actor, clientId, input);
    revalidateClient(clientId);
    return { id: driver.id };
  });
}

export async function updateDriverAction(clientId: string, driverId: string, input: unknown) {
  return action(async (actor) => {
    await updateDriver(actor, driverId, input);
    revalidateClient(clientId);
  });
}

export async function deleteDriverAction(clientId: string, driverId: string) {
  return action(async (actor) => {
    await deleteDriver(actor, driverId);
    revalidateClient(clientId);
  });
}

export async function addConvictionAction(clientId: string, driverId: string, input: unknown) {
  return action(async (actor) => {
    await addConviction(actor, driverId, input);
    revalidateClient(clientId);
  });
}

export async function deleteConvictionAction(clientId: string, id: string) {
  return action(async (actor) => {
    await deleteConviction(actor, id);
    revalidateClient(clientId);
  });
}

export async function addClaimAction(clientId: string, driverId: string, input: unknown) {
  return action(async (actor) => {
    await addClaim(actor, driverId, input);
    revalidateClient(clientId);
  });
}

export async function deleteClaimAction(clientId: string, id: string) {
  return action(async (actor) => {
    await deleteClaim(actor, id);
    revalidateClient(clientId);
  });
}

// --- Vehicles --------------------------------------------------------------

export async function addVehicleAction(clientId: string, input: unknown) {
  return action(async (actor) => {
    const vehicle = await addVehicle(actor, clientId, input);
    revalidateClient(clientId);
    return { id: vehicle.id };
  });
}

export async function updateVehicleAction(clientId: string, vehicleId: string, input: unknown) {
  return action(async (actor) => {
    await updateVehicle(actor, vehicleId, input);
    revalidateClient(clientId);
  });
}

export async function deleteVehicleAction(clientId: string, vehicleId: string) {
  return action(async (actor) => {
    await deleteVehicle(actor, vehicleId);
    revalidateClient(clientId);
  });
}

// --- Notes -----------------------------------------------------------------

export async function addNoteAction(clientId: string, body: string, isPinned = false) {
  return action(async (actor) => {
    await addNote(actor, clientId, body, isPinned);
    revalidateClient(clientId);
  });
}

export async function toggleNotePinAction(clientId: string, noteId: string, isPinned: boolean) {
  return action(async (actor) => {
    await toggleNotePin(actor, noteId, isPinned);
    revalidateClient(clientId);
  });
}

export async function deleteNoteAction(clientId: string, noteId: string) {
  return action(async (actor) => {
    await deleteNote(actor, noteId);
    revalidateClient(clientId);
  });
}

// --- Provenance ------------------------------------------------------------

/** Mark AI-extracted values on a record as checked by a person. */
export async function verifyFieldsAction(
  clientId: string,
  entityType: 'client' | 'driver' | 'vehicle',
  entityId: string,
  fieldPaths: string[],
) {
  return action(async (actor) => {
    await verifyFields(actor, entityType, entityId, fieldPaths);
    revalidateClient(clientId);
  });
}
