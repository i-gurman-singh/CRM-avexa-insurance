'use client';

import { useEffect } from 'react';

/**
 * Route-level error boundary.
 *
 * Shows a generic message: internal error text can contain client data or
 * infrastructure detail, neither of which belongs on screen. The digest is the
 * key for finding the real error in the server logs.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server errors are already logged; this catches client-side failures.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The page could not be loaded. Nothing has been lost — try again, and if it keeps happening
        send this reference to your administrator.
      </p>
      {error.digest ? (
        <code className="rounded bg-surface-muted px-2 py-1 font-mono text-xs">{error.digest}</code>
      ) : null}
      <button
        onClick={reset}
        className="mt-2 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Try again
      </button>
    </div>
  );
}
