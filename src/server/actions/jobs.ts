'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/core/audit/service';
import { requirePermission } from '@/core/context';
import { action } from '@/server/action-helpers';

/**
 * Requeue a job that exhausted its retries.
 *
 * Handlers are written to be safe to run twice, so retrying is not risky — the
 * usual cause of a dead job is a provider outage that has since resolved.
 */
export async function retryJobAction(jobId: string) {
  return action(async (actor) => {
    requirePermission(actor, 'jobs.retry');

    const job = await db.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundError('Job');

    await db.job.update({
      where: { id: jobId },
      data: { status: 'QUEUED', runAt: new Date(), attempts: 0, lastError: null, finishedAt: null },
    });

    await recordAudit({
      actor,
      action: 'job.retry',
      entityType: 'Job',
      entityId: jobId,
      metadata: { type: job.type },
    });

    revalidatePath('/settings/jobs');
  });
}
