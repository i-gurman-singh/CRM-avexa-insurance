/**
 * Loads `.env` for entry points that Next.js does not start.
 *
 * Next loads `.env` itself for the web app, but the background worker and the
 * seed script run under plain `tsx`, which does not. Without this, `npm run
 * worker` works under systemd (which reads the same file via EnvironmentFile)
 * but fails when someone runs it by hand to debug — a confusing gap, and
 * exactly the moment you least want one.
 *
 * **Import this first, for its side effect:**
 *
 *     import '@/lib/load-env';
 *     import { db } from '@/lib/db';
 *
 * The load has to happen at module-evaluation time, not in a function call,
 * because ES module imports are hoisted: by the time any statement in the entry
 * file runs, every imported module has already been evaluated — and
 * `@/lib/env` validates and caches the environment the first time anything
 * reads it. Modules are evaluated in import order, so being first is what makes
 * this work.
 *
 * Uses Node's built-in loader, so there is no dotenv dependency. Values already
 * present in the real environment win, which is what you want when systemd or a
 * deploy script has set them deliberately.
 */

// Available since Node 20.6; package.json requires >= 20.11.
const load = (process as NodeJS.Process & { loadEnvFile?: (path?: string) => void }).loadEnvFile;

if (typeof load === 'function') {
  try {
    load();
  } catch {
    // No .env file is a perfectly normal production setup — the environment is
    // supplied by systemd, a container, or the shell. Nothing to report.
  }
}

export {};
