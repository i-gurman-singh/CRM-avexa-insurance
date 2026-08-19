/**
 * Background job abstraction.
 *
 * Three providers, all speaking the same interface:
 *   inline   — runs the handler immediately in-process (dev/tests)
 *   database — durable queue in Postgres, polled by `npm run worker`
 *   sqs      — Amazon SQS, with the Job table kept as the audit/retry ledger
 *
 * Webhooks always enqueue rather than process inline in production, so the
 * HTTP 200 goes back to 360dialog in milliseconds.
 */

export const JOB_TYPES = {
  PROCESS_INBOUND_MESSAGE: 'process_inbound_message',
  DOWNLOAD_MEDIA: 'download_media',
  ANALYZE_MESSAGE: 'analyze_message',
  PROCESS_DOCUMENT: 'process_document',
  SEND_WHATSAPP_MESSAGE: 'send_whatsapp_message',
  EVALUATE_WORKFLOWS: 'evaluate_workflows',
  SWEEP_FOLLOW_UPS: 'sweep_follow_ups',
  SWEEP_STALE_CLIENTS: 'sweep_stale_clients',
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];

export interface EnqueueOptions {
  /** Delay before the job becomes eligible to run. */
  delaySeconds?: number;
  /** Higher runs first. */
  priority?: number;
  maxAttempts?: number;
  /** Second enqueue with the same key is silently dropped. */
  dedupeKey?: string;
}

export interface JobMessage<T = unknown> {
  id: string;
  type: JobType;
  payload: T;
  attempts: number;
  /** Provider-specific handle needed to acknowledge (SQS receipt handle). */
  receipt?: string;
}

export interface QueueProvider {
  readonly name: string;
  enqueue<T>(type: JobType, payload: T, opts?: EnqueueOptions): Promise<string | null>;
  /** Claim up to `limit` jobs. Returns [] when idle. */
  receive(limit: number): Promise<JobMessage[]>;
  ack(message: JobMessage): Promise<void>;
  /** Report failure; provider decides retry vs dead-letter using `attempts`. */
  fail(message: JobMessage, error: Error): Promise<void>;
}

export type JobHandler<T = any> = (payload: T, ctx: { jobId: string; attempts: number }) => Promise<void>;
