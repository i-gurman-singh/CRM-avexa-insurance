import { z } from 'zod';

/**
 * Single source of truth for configuration.
 *
 * Nothing in the codebase reads `process.env` directly — everything imports
 * from here. That gives us one place to validate, one place to document, and
 * makes it impossible to accidentally ship a server secret into the client
 * bundle — this module is server-side only.
 */

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int());

const float = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  NEXTAUTH_SECRET: z.string().min(16, 'NEXTAUTH_SECRET must be at least 16 characters'),
  NEXTAUTH_URL: z.string().url().optional(),
  SESSION_MAX_AGE: int(60 * 60 * 8),

  WHATSAPP_PROVIDER: z.enum(['mock', '360dialog']).default('mock'),
  AI_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  QUEUE_PROVIDER: z.enum(['inline', 'database', 'sqs']).default('inline'),

  DIALOG360_API_KEY: z.string().optional(),
  DIALOG360_BASE_URL: z.string().default('https://waba-v2.360dialog.io'),
  DIALOG360_PHONE_NUMBER: z.string().optional(),
  WHATSAPP_WEBHOOK_TOKEN: z.string().default('replace-me'),
  WHATSAPP_WEBHOOK_SECRET: z.string().optional(),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL_TEXT: z.string().default('gpt-4o-mini'),
  OPENAI_MODEL_VISION: z.string().default('gpt-4o'),
  AI_AUTO_APPLY_MIN_CONFIDENCE: float(0.85),
  AI_DOCUMENT_AUTO_APPLY_MIN_CONFIDENCE: float(0.9),

  AWS_REGION: z.string().default('ca-central-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_SIGNED_URL_TTL: int(300),
  SQS_QUEUE_URL: z.string().optional(),

  LOCAL_STORAGE_DIR: z.string().default('./.storage'),

  WORKER_BATCH_SIZE: int(10),
  WORKER_POLL_INTERVAL_MS: int(2000),
  WORKER_MAX_ATTEMPTS: int(5),

  AUTOMATION_OUTBOUND_ENABLED: bool(false),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\n\nSee .env.example.`);
  }

  const value = parsed.data;

  // Cross-field checks: if you pick a real provider, you must supply its keys.
  const problems: string[] = [];
  if (value.WHATSAPP_PROVIDER === '360dialog' && !value.DIALOG360_API_KEY) {
    problems.push('WHATSAPP_PROVIDER=360dialog requires DIALOG360_API_KEY');
  }
  if (value.AI_PROVIDER === 'openai' && !value.OPENAI_API_KEY) {
    problems.push('AI_PROVIDER=openai requires OPENAI_API_KEY');
  }
  if (value.STORAGE_PROVIDER === 's3' && !value.S3_BUCKET) {
    problems.push('STORAGE_PROVIDER=s3 requires S3_BUCKET');
  }
  if (value.QUEUE_PROVIDER === 'sqs' && !value.SQS_QUEUE_URL) {
    problems.push('QUEUE_PROVIDER=sqs requires SQS_QUEUE_URL');
  }
  if (value.NODE_ENV === 'production' && value.NEXTAUTH_SECRET.startsWith('replace-me')) {
    problems.push('NEXTAUTH_SECRET must be changed before running in production');
  }

  if (problems.length) {
    throw new Error(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }

  return value;
}

// Cached so validation runs once per process.
let cached: Env | null = null;

export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    if (!cached) cached = load();
    return cached[prop as keyof Env];
  },
});

export const isProduction = () => env.NODE_ENV === 'production';
export const isTest = () => env.NODE_ENV === 'test';
