import '@/lib/server-guard';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { isAppError } from './errors';
import { log } from './logger';

const logger = log('api');

/**
 * One place that turns a thrown error into an HTTP response.
 *
 * Route handlers just `throw new NotFoundError('Client')` and let this decide
 * the status code and what is safe to say. Internal errors never leak their
 * message to the caller.
 */
export function apiError(e: unknown): NextResponse {
  if (e instanceof ZodError) {
    return NextResponse.json(
      {
        error: 'validation_error',
        message: 'Invalid request',
        details: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 422 },
    );
  }

  if (isAppError(e)) {
    if (!e.expose) logger.error({ err: e }, 'API error');
    return NextResponse.json(
      {
        error: e.code,
        message: e.expose ? e.message : 'Something went wrong',
        ...(e.expose && e.details ? { details: e.details } : {}),
      },
      { status: e.status },
    );
  }

  logger.error({ err: e }, 'Unhandled API error');
  return NextResponse.json({ error: 'internal_error', message: 'Something went wrong' }, { status: 500 });
}

export function apiOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

/** Wrap a route handler so every error takes the same path. */
export function handler<Args extends unknown[]>(
  fn: (...args: Args) => Promise<NextResponse>,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (e) {
      return apiError(e);
    }
  };
}

/**
 * Very small fixed-window rate limiter, in memory.
 *
 * Enough to blunt brute-force attempts against login and to stop a
 * misconfigured webhook from hammering us. Deliberately not Redis: this app
 * runs as one or two processes on a single Lightsail instance, and adding a
 * cache server for this would be more moving parts than the problem deserves.
 * Swap the implementation here if the deployment ever scales horizontally.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    const resetAt = now + opts.windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: opts.limit - 1, resetAt };
  }

  bucket.count += 1;
  const allowed = bucket.count <= opts.limit;
  return { allowed, remaining: Math.max(0, opts.limit - bucket.count), resetAt: bucket.resetAt };
}

// Periodically drop expired buckets so the map cannot grow without bound.
if (typeof setInterval !== 'undefined') {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, 60_000);
  // Do not keep the process alive just for cleanup.
  timer.unref?.();
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}
