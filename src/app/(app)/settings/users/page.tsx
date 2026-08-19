import { redirect } from 'next/navigation';
import { can, PERMISSIONS, ROLE_PERMISSIONS } from '@/lib/rbac';
import { requireAuth } from '@/core/auth/session';
import { listUsers, ROLE_OPTIONS } from '@/core/users/service';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/primitives';
import { UserEditor } from './user-editor';

export const metadata = { title: 'Users & permissions' };
export const dynamic = 'force-dynamic';

export default async function UsersSettingsPage() {
  const user = await requireAuth();
  const subject = { role: user.role, permissionOverrides: user.permissionOverrides };

  if (!can(subject, 'users.view')) redirect('/settings');

  const users = await listUsers({ includeInactive: true });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Users</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Roles cover the common cases; per-user exceptions handle the rest — one assistant who
              is trusted with document downloads, one agent allowed to bind.
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <UserEditor
            canManage={can(subject, 'users.manage')}
            currentUserId={user.id}
            roles={ROLE_OPTIONS}
            permissions={[...PERMISSIONS]}
            rolePermissions={Object.fromEntries(
              Object.entries(ROLE_PERMISSIONS).map(([role, perms]) => [role, [...perms]]),
            )}
            users={users.map((u) => ({
              id: u.id,
              name: u.name,
              email: u.email,
              role: u.role,
              phone: u.phone,
              isActive: u.isActive,
              lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
              permissionOverrides: (u.permissionOverrides ?? {}) as Record<string, boolean>,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What each role can do</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3">
            {ROLE_OPTIONS.map((role) => (
              <div key={role.value}>
                <dt className="text-sm font-medium">{role.label}</dt>
                <dd className="text-xs text-muted-foreground">{role.description}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            Binding a policy, selecting a quote, and other regulated actions can never be performed
            by automation — only by a signed-in user who holds the permission.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
