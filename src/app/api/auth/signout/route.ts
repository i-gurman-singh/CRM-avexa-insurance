import { NextResponse } from 'next/server';
import { handler } from '@/lib/api';
import { signOut } from '@/core/auth/session';

export const POST = handler(async (request: Request) => {
  await signOut();
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
});
