import path from 'node:path';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 moves the connection URL out of schema.prisma and into this file.
 * The application itself connects through a driver adapter (see src/lib/db.ts);
 * this config is what the Prisma CLI uses for migrate / studio / db push.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
