import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { log } from '@/lib/logger';
import type { EnqueueOptions, JobMessage, JobType, QueueProvider } from './types';

const logger = log('queue:database');

/**
 * Durable queue backed by the Job table.
 *
 * Claiming uses `FOR UPDATE SKIP LOCKED`, which lets several worker processes
 * run against the same Postgres without stepping on each other. Good enough
 * for a brokerage's volume, and it removes SQS from the critical path until
 * you actually need it.
 */
export class DatabaseQueueProvider implements QueueProvider {
  readonly name = 'database';
  private workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;

  async enqueue<T>(type: JobType, payload: T, opts: EnqueueOptions = {}): Promise<string | null> {
    const runAt = new Date(Date.now() + (opts.delaySeconds ?? 0) * 1000);

    if (opts.dedupeKey) {
      const existing = await db.job.findUnique({ where: { dedupeKey: opts.dedupeKey } });
      if (existing) {
        logger.debug({ dedupeKey: opts.dedupeKey }, 'Duplicate job dropped');
        return existing.id;
      }
    }

    try {
      const job = await db.job.create({
        data: {
          type,
          payload: payload as object,
          runAt,
          priority: opts.priority ?? 0,
          maxAttempts: opts.maxAttempts ?? env.WORKER_MAX_ATTEMPTS,
          dedupeKey: opts.dedupeKey,
        },
      });
      return job.id;
    } catch (e: any) {
      // Unique violation on dedupeKey from a concurrent enqueue — fine.
      if (e?.code === 'P2002') return null;
      throw e;
    }
  }

  async receive(limit: number): Promise<JobMessage[]> {
    const now = new Date();

    // Atomically claim a batch. SKIP LOCKED means concurrent workers get
    // disjoint sets rather than blocking on each other.
    const rows = await db.$queryRaw<Array<{ id: string; type: string; payload: any; attempts: number }>>`
      UPDATE "Job"
      SET status = 'RUNNING',
          "startedAt" = ${now},
          "lockedBy" = ${this.workerId},
          "lockedAt" = ${now},
          attempts = attempts + 1,
          "updatedAt" = ${now}
      WHERE id IN (
        SELECT id FROM "Job"
        WHERE status = 'QUEUED' AND "runAt" <= ${now}
        ORDER BY priority DESC, "runAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, type, payload, attempts;
    `;

    return rows.map((r) => ({
      id: r.id,
      type: r.type as JobType,
      payload: r.payload,
      attempts: r.attempts,
    }));
  }

  async ack(message: JobMessage): Promise<void> {
    await db.job.update({
      where: { id: message.id },
      data: { status: 'SUCCEEDED', finishedAt: new Date(), lockedBy: null, lastError: null },
    });
  }

  async fail(message: JobMessage, error: Error): Promise<void> {
    const job = await db.job.findUnique({ where: { id: message.id } });
    if (!job) return;

    const exhausted = job.attempts >= job.maxAttempts;
    // Exponential backoff with a 15-minute ceiling.
    const backoffSeconds = Math.min(2 ** job.attempts * 5, 900);

    await db.job.update({
      where: { id: message.id },
      data: {
        status: exhausted ? 'DEAD' : 'QUEUED',
        runAt: exhausted ? job.runAt : new Date(Date.now() + backoffSeconds * 1000),
        lastError: error.message.slice(0, 2000),
        lockedBy: null,
        lockedAt: null,
        finishedAt: exhausted ? new Date() : null,
      },
    });

    if (exhausted) {
      logger.error({ jobId: job.id, type: job.type, err: error }, 'Job exhausted retries');
    }
  }

  /** Requeue a dead job — used by the admin Jobs screen. */
  async retry(jobId: string): Promise<void> {
    await db.job.update({
      where: { id: jobId },
      data: { status: 'QUEUED', runAt: new Date(), attempts: 0, lastError: null, finishedAt: null },
    });
  }
}
