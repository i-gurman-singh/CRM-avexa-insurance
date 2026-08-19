import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { env } from './env';

/**
 * Single Prisma instance.
 *
 * Prisma 7 connects through a driver adapter (node-postgres here) rather than
 * a Rust engine binary, so the connection string is passed in code. In
 * development Next.js hot-reloads modules, which would otherwise leak a new
 * connection pool on every edit — hence the global cache.
 */

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function create(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    // Lightsail runs Postgres on the same host, so a modest pool is plenty.
    max: env.NODE_ENV === 'production' ? 10 : 5,
  });

  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const db: PrismaClient = globalThis.__prisma ?? create();

if (env.NODE_ENV !== 'production') {
  globalThis.__prisma = db;
}

/**
 * Transaction client. Services take this so they can be composed inside a
 * single `db.$transaction(...)` when several writes must be atomic.
 */
export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/** Either the shared client or an open transaction. */
export type DbClient = PrismaClient | Tx;
