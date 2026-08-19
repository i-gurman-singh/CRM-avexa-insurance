'use server';

import { revalidatePath } from 'next/cache';
import type { Permission } from '@/lib/rbac';
import type { SettingKey } from '@/core/settings/defaults';
import { resetSetting, setSetting } from '@/core/settings/service';
import {
  createAgeGroup,
  createCustomField,
  createDocumentType,
  createInsuranceCompany,
  createLeadSource,
  createLostReason,
  createQuoteStatus,
  createStage,
  createTaskType,
  deleteAgeGroup,
  reorderStages,
  setStageActive,
  updateAgeGroup,
  updateCustomField,
  updateDocumentType,
  updateInsuranceCompany,
  updateLeadSource,
  updateLostReason,
  updateQuoteStatus,
  updateStage,
  updateTaskType,
} from '@/core/settings/lookups';
import {
  createUser,
  setPermissionOverride,
  setUserPassword,
  updateUser,
} from '@/core/users/service';
import { action } from '@/server/action-helpers';

/**
 * Administration.
 *
 * Everything an administrator can reconfigure without a developer: pipeline
 * stages, insurance companies, document types, task types, quote statuses,
 * lead sources, lost reasons, age groups, custom fields, automation settings
 * and users.
 */

function revalidateSettings() {
  revalidatePath('/settings', 'layout');
  revalidatePath('/pipeline');
  revalidatePath('/');
}

// --- Automation settings ---------------------------------------------------

export async function setSettingAction(key: SettingKey, value: unknown) {
  return action(async (actor) => {
    await setSetting(actor, key, value);
    revalidateSettings();
  });
}

export async function resetSettingAction(key: SettingKey) {
  return action(async (actor) => {
    await resetSetting(actor, key);
    revalidateSettings();
  });
}

// --- Pipeline stages -------------------------------------------------------

export async function createStageAction(input: unknown) {
  return action(async (actor) => {
    const stage = await createStage(actor, input as never);
    revalidateSettings();
    return { id: stage.id };
  });
}

export async function updateStageAction(id: string, input: unknown) {
  return action(async (actor) => {
    await updateStage(actor, id, input as never);
    revalidateSettings();
  });
}

export async function reorderStagesAction(orderedIds: string[]) {
  return action(async (actor) => {
    await reorderStages(actor, orderedIds);
    revalidateSettings();
  });
}

export async function setStageActiveAction(id: string, isActive: boolean) {
  return action(async (actor) => {
    await setStageActive(actor, id, isActive);
    revalidateSettings();
  });
}

// --- Lookups ---------------------------------------------------------------

export async function createLeadSourceAction(name: string) {
  return action(async (actor) => {
    await createLeadSource(actor, name);
    revalidateSettings();
  });
}

export async function updateLeadSourceAction(id: string, input: unknown) {
  return action(async (actor) => {
    await updateLeadSource(actor, id, input as never);
    revalidateSettings();
  });
}

export async function createLostReasonAction(name: string) {
  return action(async (actor) => {
    await createLostReason(actor, name);
    revalidateSettings();
  });
}

export async function updateLostReasonAction(id: string, input: unknown) {
  return action(async (actor) => {
    await updateLostReason(actor, id, input as never);
    revalidateSettings();
  });
}

export async function createInsuranceCompanyAction(input: unknown) {
  return action(async (actor) => {
    await createInsuranceCompany(actor, input as never);
    revalidateSettings();
  });
}

export async function updateInsuranceCompanyAction(id: string, input: unknown) {
  return action(async (actor) => {
    await updateInsuranceCompany(actor, id, input as never);
    revalidateSettings();
  });
}

export async function createTaskTypeAction(input: unknown) {
  return action(async (actor) => {
    await createTaskType(actor, input as never);
    revalidateSettings();
  });
}

export async function updateTaskTypeAction(id: string, input: unknown) {
  return action(async (actor) => {
    await updateTaskType(actor, id, input as never);
    revalidateSettings();
  });
}

export async function createQuoteStatusAction(input: unknown) {
  return action(async (actor) => {
    await createQuoteStatus(actor, input as never);
    revalidateSettings();
  });
}

export async function updateQuoteStatusAction(id: string, input: unknown) {
  return action(async (actor) => {
    await updateQuoteStatus(actor, id, input as never);
    revalidateSettings();
  });
}

export async function createDocumentTypeAction(input: unknown) {
  return action(async (actor) => {
    await createDocumentType(actor, input as never);
    revalidateSettings();
  });
}

export async function updateDocumentTypeAction(id: string, input: unknown) {
  return action(async (actor) => {
    await updateDocumentType(actor, id, input as never);
    revalidateSettings();
  });
}

export async function createAgeGroupAction(input: unknown) {
  return action(async (actor) => {
    await createAgeGroup(actor, input as never);
    revalidateSettings();
    revalidatePath('/analytics');
  });
}

export async function updateAgeGroupAction(id: string, input: unknown) {
  return action(async (actor) => {
    await updateAgeGroup(actor, id, input as never);
    revalidateSettings();
    revalidatePath('/analytics');
  });
}

export async function deleteAgeGroupAction(id: string) {
  return action(async (actor) => {
    await deleteAgeGroup(actor, id);
    revalidateSettings();
    revalidatePath('/analytics');
  });
}

// --- Custom fields ---------------------------------------------------------

export async function createCustomFieldAction(input: unknown) {
  return action(async (actor) => {
    await createCustomField(actor, input as never);
    revalidateSettings();
  });
}

export async function updateCustomFieldAction(id: string, input: unknown) {
  return action(async (actor) => {
    await updateCustomField(actor, id, input as never);
    revalidateSettings();
  });
}

// --- Users -----------------------------------------------------------------

export async function createUserAction(input: unknown) {
  return action(async (actor) => {
    const user = await createUser(actor, input);
    revalidateSettings();
    return { id: user.id };
  });
}

export async function updateUserAction(id: string, input: unknown) {
  return action(async (actor) => {
    await updateUser(actor, id, input);
    revalidateSettings();
  });
}

export async function setUserPasswordAction(id: string, password: string) {
  return action(async (actor) => {
    await setUserPassword(actor, id, password);
    revalidateSettings();
  });
}

export async function setPermissionOverrideAction(
  id: string,
  permission: Permission,
  allowed: boolean | null,
) {
  return action(async (actor) => {
    await setPermissionOverride(actor, id, permission, allowed);
    revalidateSettings();
  });
}
