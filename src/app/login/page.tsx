import { redirect } from 'next/navigation';
import { auth } from '@/core/auth/session';
import { getSetting } from '@/core/settings/service';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await auth();
  if (user) redirect('/');

  const { next } = await searchParams;
  const brokerageName = await getSetting('general.brokerageName').catch(() => 'Insurance CRM');

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground">
            {brokerageName.slice(0, 1).toUpperCase()}
          </span>
          <h1 className="text-lg font-semibold tracking-tight">{brokerageName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to the CRM</p>
        </div>

        <LoginForm next={next} />

        <p className="mt-6 text-center text-xs text-muted-foreground">
          This system contains confidential client information. Access is logged.
        </p>
      </div>
    </div>
  );
}
