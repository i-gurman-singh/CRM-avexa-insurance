import { can } from '@/lib/rbac';
import { requireAuth } from '@/core/auth/session';
import { listCustomFields } from '@/core/settings/lookups';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/primitives';
import { CustomFieldEditor } from './custom-field-editor';

export const metadata = { title: 'Custom fields' };
export const dynamic = 'force-dynamic';

export default async function CustomFieldsPage() {
  const user = await requireAuth();
  const canManage = can(
    { role: user.role, permissionOverrides: user.permissionOverrides },
    'settings.manage',
  );

  const fields = await listCustomFields();

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Custom fields</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Extra fields on clients, drivers, vehicles, quotes and policies. Values are stored in a
            flexible column, so adding one takes effect immediately with no database migration and
            no downtime. If a custom field becomes central to how you work, ask a developer to
            promote it to a real column — it will be faster to filter and report on.
          </p>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <CustomFieldEditor
          canManage={canManage}
          fields={fields.map((f) => ({
            id: f.id,
            entity: f.entity,
            key: f.key,
            label: f.label,
            fieldType: f.fieldType,
            required: f.required,
            helpText: f.helpText,
            isActive: f.isActive,
          }))}
        />
      </CardContent>
    </Card>
  );
}
