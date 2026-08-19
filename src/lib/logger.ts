import pino from 'pino';
import { env } from './env';

/**
 * Structured logging. Field names are kept stable so log queries survive
 * refactors. Never log document bytes, full message payloads with PII, or
 * credentials — use `redact` below for anything borderline.
 */

const redactPaths = [
  'password',
  'passwordHash',
  '*.password',
  '*.passwordHash',
  'apiKey',
  '*.apiKey',
  'authorization',
  'headers.authorization',
  'headers["d360-api-key"]',
  'req.headers.cookie',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: redactPaths, censor: '[redacted]' },
  base: { service: 'insurance-crm' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/** Namespaced child logger, e.g. `log('whatsapp')`. */
export function log(module: string) {
  return logger.child({ module });
}

/** Mask a phone number for logs: +14165551234 -> +1416***1234 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  if (phone.length <= 8) return '***';
  return `${phone.slice(0, 5)}***${phone.slice(-4)}`;
}
