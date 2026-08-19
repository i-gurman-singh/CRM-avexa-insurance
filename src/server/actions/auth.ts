'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { signIn, signOut } from '@/core/auth/session';
import { changeOwnPassword } from '@/core/users/service';
import { action, anonymousAction, type ActionResult } from '@/server/action-helpers';

export async function signInAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/');

  if (!email || !password) {
    return { ok: false, error: 'Enter your email and password' };
  }

  const h = await headers();
  const result = await anonymousAction(async () => {
    const user = await signIn(email, password, {
      ipAddress: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
      userAgent: h.get('user-agent') ?? undefined,
    });
    if (!user) throw new Error('invalid credentials');
    return null;
  });

  if (!result.ok) {
    // Deliberately vague: never reveal whether the account exists.
    return { ok: false, error: 'That email and password combination is not correct' };
  }

  // Only same-origin redirects are honoured.
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/');
}

export async function signOutAction() {
  await signOut();
  redirect('/login');
}

export async function changePasswordAction(formData: FormData) {
  return action(async (actor) =>
    changeOwnPassword(
      actor,
      String(formData.get('currentPassword') ?? ''),
      String(formData.get('newPassword') ?? ''),
    ),
  );
}
