import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { handler } from '@/lib/api';
import { currentActor } from '@/core/auth/session';
import { getDownloadUrl, readDocument } from '@/core/documents/service';

/**
 * Document access.
 *
 * There is no public URL for a client document, ever. This route checks the
 * session and the `documents.download` permission, writes an audit entry, and
 * then either redirects to a signed URL that expires in minutes (S3) or
 * streams the bytes back (local storage / inline preview).
 *
 *   /api/documents/<id>/download            -> redirect to a signed URL
 *   /api/documents/<id>/download?inline=1   -> stream for preview
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const h = await headers();

  const actor = await currentActor({
    ipAddress: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    userAgent: h.get('user-agent') ?? undefined,
  });

  const inline = new URL(request.url).searchParams.get('inline') === '1';

  if (inline) {
    const { document, object } = await readDocument(actor, id);
    return new NextResponse(new Uint8Array(object.body), {
      headers: {
        'Content-Type': object.contentType,
        'Content-Length': String(object.sizeBytes),
        'Content-Disposition': `inline; filename="${document.filename.replace(/"/g, '')}"`,
        // Personal documents must never be cached by a proxy.
        'Cache-Control': 'private, no-store, max-age=0',
      },
    });
  }

  const url = await getDownloadUrl(actor, id);
  return NextResponse.redirect(url, { status: 302 });
});
