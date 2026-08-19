import { randomUUID } from 'node:crypto';
import { log } from '@/lib/logger';
import type { EnqueueOptions, JobMessage, JobType, QueueProvider } from './types';

const logger = log('queue:inline');

/**
 * Runs handlers immediately, in-process, on the next tick.
 *
 * For local development and tests only — a crash loses in-flight work, and the
 * webhook response would block on AI calls. Production should use `database`
 * or `sqs`.
 */
export class InlineQueueProvider implements QueueProvider {
  readonly name = 'inline';
  private seen = new Set<string>();
  private runner: ((message: JobMessage) => Promise<void>) | null = null;

  /** Wired up by the registry so we avoid a circular import. */
  setRunner(runner: (message: JobMessage) => Promise<void>) {
    this.runner = runner;
  }

  async enqueue<T>(type: JobType, payload: T, opts: EnqueueOptions = {}): Promise<string | null> {
    if (opts.dedupeKey) {
      if (this.seen.has(opts.dedupeKey)) return null;
      this.seen.add(opts.dedupeKey);
    }

    const message: JobMessage<T> = { id: randomUUID(), type, payload, attempts: 1 };

    // Deliberately not awaited: mirrors real queue semantics so callers can't
    // accidentally depend on synchronous completion.
    setTimeout(() => {
      if (!this.runner) {
        logger.warn({ type }, 'Inline queue has no runner; job dropped');
        return;
      }
      this.runner(message).catch((e) => logger.error({ err: e, type }, 'Inline job failed'));
    }, (opts.delaySeconds ?? 0) * 1000);

    return message.id;
  }

  async receive(): Promise<JobMessage[]> {
    return [];
  }

  async ack(): Promise<void> {}

  async fail(message: JobMessage, error: Error): Promise<void> {
    logger.error({ err: error, type: message.type }, 'Inline job failed');
  }
}
