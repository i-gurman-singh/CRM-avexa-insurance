import { NextResponse } from 'next/server';
import { handler } from '@/lib/api';
import { env } from '@/lib/env';
import { ForbiddenError, NotFoundError } from '@/lib/errors';
import { getStorage } from '@/integrations/storage';
import { verifyLocalSignature } from '@/integrations/storage/local';
import { requireAuth } from '@/core/auth/session';

/**
 * Serves objects for the local (development) storage provider, standing in for
 * S3 pre-signed URLs so that `getSignedUrl` behaves the same in both modes.
 *
 * Requires BOTH a valid HMAC signature and an authenticated session — the
 * signature alone is a bearer token, and client documents deserve belt and
 * braces. This route refuses to run when the real S3 provider is configured.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = handler(async (request: Request) => {
  if (env.STORAGE_PROVIDER !== 'local') {
    throw new NotFoundError('Route');
  }

  await requireAuth();

  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  const expires = Number(url.searchParams.get('expires'));
  const signature = url.searchParams.get('signature');
  const filename = url.searchParams.get('filename');

  if (!key || !signature || !Number.isFinite(expires)) {
    throw new NotFoundError('Object');
  }

  if (!verifyLocalSignature(key, expires, signature)) {
    throw new ForbiddenError('That download link has expired');
  }

  const object = await getStorage().get(key);

  return new NextResponse(new Uint8Array(object.body), {
    headers: {
      'Content-Type': object.contentType,
      'Content-Length': String(object.sizeBytes),
      'Content-Disposition': filename
        ? `attachment; filename="${filename.replace(/"/g, '')}"`
        : 'inline',
      'Cache-Control': 'private, no-store, max-age=0',
    },
  });
});
