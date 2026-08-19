/**
 * Typed application errors. API routes map these to status codes in one place
 * (src/lib/api.ts) so handlers can just `throw new NotFoundError('Client')`.
 */

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  /** Safe to show a user? Internal errors get a generic message instead. */
  readonly expose: boolean;

  constructor(
    message: string,
    opts: { status?: number; code?: string; details?: unknown; expose?: boolean } = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.status = opts.status ?? 500;
    this.code = opts.code ?? 'internal_error';
    this.details = opts.details;
    this.expose = opts.expose ?? this.status < 500;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(message, { status: 422, code: 'validation_error', details });
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, { status: 404, code: 'not_found' });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, { status: 401, code: 'unauthorized' });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do that') {
    super(message, { status: 403, code: 'forbidden' });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: unknown) {
    super(message, { status: 409, code: 'conflict', details });
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, { status: 429, code: 'rate_limited' });
  }
}

/** Raised by integration adapters so callers can distinguish "their fault". */
export class IntegrationError extends AppError {
  readonly provider: string;
  readonly retryable: boolean;

  constructor(
    provider: string,
    message: string,
    opts: { retryable?: boolean; details?: unknown } = {},
  ) {
    super(`[${provider}] ${message}`, {
      status: 502,
      code: 'integration_error',
      details: opts.details,
    });
    this.provider = provider;
    this.retryable = opts.retryable ?? true;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
