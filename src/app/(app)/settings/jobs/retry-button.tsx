'use client';

import { useState, useTransition } from 'react';
import { RotateCcwIcon } from 'lucide-react';
import { retryJobAction } from '@/server/actions/jobs';
import { Button } from '@/ui/components/primitives';

export function RetryJobButton({ jobId }: { jobId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await retryJobAction(jobId);
            if (!result.ok) setError(result.error);
          })
        }
      >
        <RotateCcwIcon className="size-3.5" />
        Retry
      </Button>
      {error ? <span className="ml-2 text-xs text-critical">{error}</span> : null}
    </>
  );
}
