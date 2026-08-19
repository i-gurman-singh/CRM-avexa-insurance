import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge middleware: a cheap first gate, not the security boundary.
 *
 * It only checks that a session cookie is present, so an unauthenticated
 * visitor gets bounced to /login without spinning up a database query. The
 * real check — is the token valid, is the user still active, do they have the
 * permission — happens in the layout and in every service call. Never rely on
 * this alone.
 */

const PUBLIC_PATHS = ['/login', '/api/webhooks', '/api/health', '/api/auth'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const hasSession = request.cookies.has('crm_session');

  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Preserve where they were heading so login can send them back.
    if (pathname !== '/') url.searchParams.set('next', pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals and static assets.
     */
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
