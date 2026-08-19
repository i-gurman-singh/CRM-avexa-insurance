/**
 * Marker for modules that must never reach the browser bundle.
 *
 * Import this at the top of any file that touches the database, secrets, or a
 * provider SDK:
 *
 *     import '@/lib/server-guard';
 *
 * We use this instead of the `server-only` package because the background
 * worker (src/worker) runs under plain Node, where `server-only` resolves to a
 * module that throws unconditionally — it only stays silent under Next.js's
 * `react-server` export condition. This guard is equivalent for the case that
 * actually matters (accidental client import) and works in every runtime we
 * deploy to.
 */
if (typeof window !== 'undefined') {
  throw new Error(
    'A server-only module was imported into client-side code. ' +
      'Move the call into a Server Component, a server action, or an API route.',
  );
}

export {};
