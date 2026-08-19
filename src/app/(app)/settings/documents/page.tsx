import { can } from '@/lib/rbac';
import { EXTRACTOR_KEYS } from '@/integrations/ai/vocabulary';
import { requireAuth } from '@/core/auth/session';
import { listDocumentTypes } from '@/core/settings/lookups';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/primitives';
import { DocumentTypeEditor } from './document-type-editor';

export const metadata = { title: 'Document types' };
export const dynamic = 'force-dynamic';

export default async function DocumentSettingsPage() {
  const user = await requireAuth();
  const canManage = can(
    { role: user.role, permissionOverrides: user.permissionOverrides },
    'settings.manage',
  );

  const types = await listDocumentTypes(true);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Document types</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            What the CRM asks clients for, and what AI tries to read from each one. A type marked
            required appears on every new client&apos;s checklist and blocks binding until it
            arrives or is waived.
          </p>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <DocumentTypeEditor
          canManage={canManage}
          extractorKeys={EXTRACTOR_KEYS}
          types={types.map((t) => ({
            id: t.id,
            key: t.key,
            name: t.name,
            description: t.description,
            extractorKey: t.extractorKey,
            requiredByDefault: t.requiredByDefault,
            requestTemplate: t.requestTemplate,
            isActive: t.isActive,
          }))}
        />
      </CardContent>
    </Card>
  );
}
