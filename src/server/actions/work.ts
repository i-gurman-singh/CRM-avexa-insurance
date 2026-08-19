'use server';

import { revalidatePath } from 'next/cache';
import type { FollowUpStatus, TaskStatus } from '@/lib/types';
import {
  assignTask,
  createTask,
  deleteTask,
  setTaskStatus,
  updateTask,
} from '@/core/tasks/service';
import {
  completeFollowUp,
  createFollowUp,
  deleteFollowUp,
  setFollowUpStatus,
  snoozeFollowUp,
  updateFollowUp,
} from '@/core/followups/service';
import {
  markAllNotificationsRead,
  markNotificationRead,
} from '@/core/notifications/service';
import { action } from '@/server/action-helpers';

/** Tasks, follow-ups and notifications — the day-to-day work queues. */

function revalidateWork(clientId?: string | null) {
  revalidatePath('/tasks');
  revalidatePath('/follow-ups');
  revalidatePath('/');
  if (clientId) revalidatePath(`/clients/${clientId}`);
}

// --- Tasks -----------------------------------------------------------------

export async function createTaskAction(input: unknown) {
  return action(async (actor) => {
    const task = await createTask(actor, input);
    revalidateWork(task.clientId);
    return { id: task.id };
  });
}

export async function updateTaskAction(taskId: string, input: unknown) {
  return action(async (actor) => {
    const task = await updateTask(actor, taskId, input);
    revalidateWork(task.clientId);
  });
}

export async function setTaskStatusAction(taskId: string, status: TaskStatus) {
  return action(async (actor) => {
    const task = await setTaskStatus(actor, taskId, status);
    revalidateWork(task.clientId);
  });
}

export async function assignTaskAction(taskId: string, userId: string | null) {
  return action(async (actor) => {
    const task = await assignTask(actor, taskId, userId);
    revalidateWork(task.clientId);
  });
}

export async function deleteTaskAction(taskId: string) {
  return action(async (actor) => {
    const task = await deleteTask(actor, taskId);
    revalidateWork(task.clientId);
  });
}

// --- Follow-ups ------------------------------------------------------------

export async function createFollowUpAction(clientId: string, input: unknown) {
  return action(async (actor) => {
    const followUp = await createFollowUp(actor, clientId, input);
    revalidateWork(clientId);
    return { id: followUp.id };
  });
}

export async function updateFollowUpAction(id: string, input: unknown) {
  return action(async (actor) => {
    const followUp = await updateFollowUp(actor, id, input);
    revalidateWork(followUp.clientId);
  });
}

export async function completeFollowUpAction(id: string, outcome?: string) {
  return action(async (actor) => {
    const followUp = await completeFollowUp(actor, id, outcome);
    revalidateWork(followUp.clientId);
  });
}

export async function snoozeFollowUpAction(id: string, untilIso: string) {
  return action(async (actor) => {
    const followUp = await snoozeFollowUp(actor, id, new Date(untilIso));
    revalidateWork(followUp.clientId);
  });
}

export async function setFollowUpStatusAction(id: string, status: FollowUpStatus) {
  return action(async (actor) => {
    const followUp = await setFollowUpStatus(actor, id, status);
    revalidateWork(followUp.clientId);
  });
}

export async function deleteFollowUpAction(id: string) {
  return action(async (actor) => {
    const followUp = await deleteFollowUp(actor, id);
    revalidateWork(followUp.clientId);
  });
}

// --- Notifications ---------------------------------------------------------

export async function markNotificationReadAction(id: string) {
  return action(async (actor) => {
    await markNotificationRead(actor, id);
    revalidatePath('/notifications');
  });
}

export async function markAllNotificationsReadAction() {
  return action(async (actor) => {
    await markAllNotificationsRead(actor.id);
    revalidatePath('/notifications');
  });
}
