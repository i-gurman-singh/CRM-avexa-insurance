import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { IntegrationError } from '@/lib/errors';
import { log } from '@/lib/logger';
import type { EnqueueOptions, JobMessage, JobType, QueueProvider } from './types';

const logger = log('queue:sqs');

/**
 * SQS transport with the Job table kept as the durable ledger.
 *
 * Why both: SQS gives us scale and retries, but no queryable history. Writing
 * a Job row first means the Jobs admin screen, retry button and failure
 * dashboards work identically whichever provider is configured.
 */
export class SqsQueueProvider implements QueueProvider {
  readonly name = 'sqs';
  private client: SQSClient;
  private queueUrl: string;

  constructor() {
    if (!env.SQS_QUEUE_URL) throw new Error('SQS_QUEUE_URL is required for the sqs queue provider');
    this.queueUrl = env.SQS_QUEUE_URL;
    this.client = new SQSClient({
      region: env.AWS_REGION,
      credentials:
        env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
          ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }
          : undefined,
    });
  }

  async enqueue<T>(type: JobType, payload: T, opts: EnqueueOptions = {}): Promise<string | null> {
    if (opts.dedupeKey) {
      const existing = await db.job.findUnique({ where: { dedupeKey: opts.dedupeKey } });
      if (existing) return existing.id;
    }

    const job = await db.job.create({
      data: {
        type,
        payload: payload as object,
        runAt: new Date(Date.now() + (opts.delaySeconds ?? 0) * 1000),
        priority: opts.priority ?? 0,
        maxAttempts: opts.maxAttempts ?? env.WORKER_MAX_ATTEMPTS,
        dedupeKey: opts.dedupeKey,
      },
    });

    try {
      await this.client.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify({ jobId: job.id, type, payload }),
          // SQS caps DelaySeconds at 900.
          DelaySeconds: Math.min(opts.delaySeconds ?? 0, 900),
        }),
      );
    } catch (e) {
      // The ledger row survives, so the database worker can still pick it up.
      logger.error({ err: e, jobId: job.id }, 'SQS send failed; job remains queued in database');
      throw new IntegrationError('sqs', 'Failed to enqueue job');
    }

    return job.id;
  }

  async receive(limit: number): Promise<JobMessage[]> {
    const res = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: Math.min(limit, 10),
        WaitTimeSeconds: 10, // long polling
        VisibilityTimeout: 120,
      }),
    );

    const messages: JobMessage[] = [];
    for (const m of res.Messages ?? []) {
      try {
        const parsed = JSON.parse(m.Body ?? '{}');
        const job = await db.job.update({
          where: { id: parsed.jobId },
          data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
        });
        messages.push({
          id: job.id,
          type: job.type as JobType,
          payload: job.payload,
          attempts: job.attempts,
          receipt: m.ReceiptHandle,
        });
      } catch (e) {
        logger.error({ err: e }, 'Failed to hydrate SQS message; deleting to avoid a poison loop');
        if (m.ReceiptHandle) {
          await this.client.send(
            new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: m.ReceiptHandle }),
          );
        }
      }
    }
    return messages;
  }

  async ack(message: JobMessage): Promise<void> {
    if (message.receipt) {
      await this.client.send(
        new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: message.receipt }),
      );
    }
    await db.job.update({
      where: { id: message.id },
      data: { status: 'SUCCEEDED', finishedAt: new Date() },
    });
  }

  async fail(message: JobMessage, error: Error): Promise<void> {
    const job = await db.job.findUnique({ where: { id: message.id } });
    if (!job) return;
    const exhausted = job.attempts >= job.maxAttempts;

    await db.job.update({
      where: { id: message.id },
      data: {
        status: exhausted ? 'DEAD' : 'QUEUED',
        lastError: error.message.slice(0, 2000),
        finishedAt: exhausted ? new Date() : null,
      },
    });

    // Not deleting the SQS message lets its visibility timeout expire and SQS
    // redeliver. On the final attempt we delete so the redrive policy can move
    // it to the dead-letter queue cleanly.
    if (exhausted && message.receipt) {
      await this.client.send(
        new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: message.receipt }),
      );
    }
  }
}
