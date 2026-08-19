import Link from 'next/link';
import { redirect } from 'next/navigation';
import { can } from '@/lib/rbac';
import { requireAuth } from '@/core/auth/session';
import { PageHeader } from '@/ui/components/primitives';
import { SettingsNav } from './settings-nav';

/**
 * Settings area.
 *
 * Everything here exists so the brokerage can change how the CRM behaves
 * without a developer: stages, companies, document types, task types, age
 * groups, automation thresholds, custom fields and users.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth();

  if (!can({ role: user.role, permissionOverrides: user.permissionOverrides }, 'settings.view')) {
    redirect('/');
  }

  const canManage = can(
    { role: user.role, permissionOverrides: user.permissionOverrides },
    'settings.manage',
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        description={
          canManage
            ? 'Change how the CRM behaves without touching code.'
            : 'You can view these settings. Ask an administrator to change them.'
        }
      />

      <div className="flex flex-col gap-5 lg:flex-row">
        <SettingsNav canManageUsers={can({ role: user.role, permissionOverrides: user.permissionOverrides }, 'users.view')} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
