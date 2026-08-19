/**
 * Background worker.
 *
 *   npm run worker
 *
 * Claims jobs from whichever queue provider is configured, runs the matching
 * handler, and acknowledges or fails with backoff. Several workers can run
 * against the same database safely — job claiming uses FOR UPDATE SKIP LOCKED.
 *
 * On Lightsail this runs as a second systemd service alongside the web app.
 * See docs/DEPLOYMENT.md.
 */
// Must be first: loads .env before `@/lib/env` is evaluated and caches it.
import '@/lib/load-env';

import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { log } from '@/lib/logger';
import { getQueue, JOB_TYPES, type JobMessage } from '@/integrations/queue';
import { InlineQueueProvider } from '@/integrations/queue/inline';
import { getHandler } from './handlers';

const logger = log('worker');

let running = true;
let inFlight = 0;

async function runJob(message: JobMessage): Promise<void> {
  const handler = getHandler(message.type);
  const queue = getQueue();

  if (!handler) {
    logger.error({ type: message.type, jobId: message.id }, 'No handler registered');
    await queue.fail(message, new Error(`No handler for job type ${message.type}`));
    return;
  }

  const started = Date.now();
  inFlight += 1;

  try {
    await handler(message.payload, { jobId: message.id, attempts: message.attempts });
    await queue.ack(message);
    logger.info(
      { type: message.type, jobId: message.id, ms: Date.now() - started },
      'Job completed',
    );
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    logger.error(
      { err: error, type: message.type, jobId: message.id, attempt: message.attempts },
      'Job failed',
    );
    await queue.fail(message, error);
  } finally {
    inFlight -= 1;
  }
}

/** Periodic maintenance, enqueued on a fixed cadence. */
async function scheduleSweeps() {
  const queue = getQueue();
  const hourKey = new Date().toISOString().slice(0, 13); // yyyy-mm-ddThh

  await queue.enqueue(
    JOB_TYPES.SWEEP_FOLLOW_UPS,
    {},
    { dedupeKey: `sweep-followups:${hourKey}`, priority: -5 },
  );
  await queue.enqueue(
    JOB_TYPES.SWEEP_STALE_CLIENTS,
    {},
    { dedupeKey: `sweep-stale:${hourKey}`, priority: -5 },
  );
}

async function main() {
  const queue = getQueue();

  if (queue instanceof InlineQueueProvider) {
    logger.error(
      'QUEUE_PROVIDER=inline runs jobs inside the web process; the worker has nothing to do. Set QUEUE_PROVIDER=database or sqs.',
    );
    process.exit(1);
  }

  logger.info(
    { provider: queue.name, batchSize: env.WORKER_BATCH_SIZE },
    'Worker started',
  );

  let lastSweep = 0;

  while (running) {
    try {
      // Enqueue maintenance work roughly hourly.
      if (Date.now() - lastSweep > 3600_000) {
        await scheduleSweeps();
        lastSweep = Date.now();
      }

      const messages = await queue.receive(env.WORKER_BATCH_SIZE);

      if (!messages.length) {
        await sleep(env.WORKER_POLL_INTERVAL_MS);
        continue;
      }

      // Run the batch concurrently; each job is independent.
      await Promise.all(messages.map((m) => runJob(m)));
    } catch (e) {
      logger.error({ err: e }, 'Worker loop error');
      await sleep(5000);
    }
  }

  // Drain before exiting so no job is left half-done.
  logger.info({ inFlight }, 'Shutting down; waiting for in-flight jobs');
  const deadline = Date.now() + 30_000;
  while (inFlight > 0 && Date.now() < deadline) await sleep(200);

  await db.$disconnect();
  logger.info('Worker stopped');
  process.exit(0);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (!running) process.exit(1); // second signal: force
    logger.info({ signal }, 'Received shutdown signal');
    running = false;
  });
}

main().catch((e) => {
  logger.fatal({ err: e }, 'Worker crashed');
  process.exit(1);
});
