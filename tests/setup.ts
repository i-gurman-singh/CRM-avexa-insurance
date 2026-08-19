/**
 * Test environment.
 *
 * Runs before any test module is imported, which matters because `@/lib/env`
 * validates and caches the environment the first time anything reads it — and
 * `@/lib/logger` reads it at import time. Setting these inside a test file
 * would be too late.
 */
// NODE_ENV is typed read-only, hence the indirect assignment.
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXTAUTH_SECRET ??= 'test-secret-at-least-sixteen-characters';
process.env.LOG_LEVEL ??= 'error';

// Providers stay on their offline implementations; these keys only exist so
// the real adapters can be constructed and their parsing logic exercised.
process.env.DIALOG360_API_KEY ??= 'test-key';
process.env.OPENAI_API_KEY ??= 'test-key';
