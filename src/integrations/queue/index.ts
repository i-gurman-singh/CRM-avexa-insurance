import '@/lib/server-guard';
import { env } from '@/lib/env';
import { DatabaseQueueProvider } from './database';
import { InlineQueueProvider } from './inline';
import { SqsQueueProvider } from './sqs';
import type { EnqueueOptions, JobType, QueueProvider } from './types';

export * from './types';
export { DatabaseQueueProvider } from './database';

let instance: QueueProvider | null = null;

export function getQueue(): QueueProvider {
  if (!instance) {
    switch (env.QUEUE_PROVIDER) {
      case 'sqs':
        instance = new SqsQueueProvider();
        break;
      case 'database':
        instance = new DatabaseQueueProvider();
        break;
      default: {
        const inline = new InlineQueueProvider();
        // Wire the handler registry lazily: importing it eagerly would create a
        // cycle (handlers -> services -> queue -> handlers).
        inline.setRunner(async (message) => {
          const { getHandler } = await import('@/worker/handlers');
          const handler = getHandler(message.type);
          if (!handler) return;
          await handler(message.payload, { jobId: message.id, attempts: message.attempts });
        });
        instance = inline;
      }
    }
  }
  return instance;
}

/**
 * Convenience wrapper used everywhere in the app.
 * Never throws: a queueing failure must not take down the caller (especially
 * the WhatsApp webhook, which has to return 200 fast).
 */
export async function enqueue<T>(
  type: JobType,
  payload: T,
  opts?: EnqueueOptions,
): Promise<string | null> {
  try {
    return await getQueue().enqueue(type, payload, opts);
  } catch (e) {
    const { log } = await import('@/lib/logger');
    log('queue').error({ err: e, type }, 'Enqueue failed');
    return null;
  }
}

export function __setQueue(provider: QueueProvider | null) {
  instance = provider;
}
