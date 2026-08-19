import { can } from '@/lib/rbac';
import { db } from '@/lib/db';
import { requireAuth } from '@/core/auth/session';
import { listStages } from '@/core/settings/lookups';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/primitives';
import { StageEditor } from './stage-editor';

export const metadata = { title: 'Pipeline stages' };
export const dynamic = 'force-dynamic';

export default async function PipelineSettingsPage() {
  const user = await requireAuth();
  const canManage = can(
    { role: user.role, permissionOverrides: user.permissionOverrides },
    'settings.manage',
  );

  const stages = await listStages({ includeInactive: true });
  const counts = await db.client.groupBy({
    by: ['stageId'],
    where: { isArchived: false },
    _count: { _all: true },
  });
  const countByStage = new Map(counts.map((c) => [c.stageId, c._count._all]));

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Pipeline stages</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Add, rename, recolour and reorder the stages a client moves through. The stage{' '}
            <em>key</em> is fixed once created because workflow rules refer to it — renaming the
            label is always safe.
          </p>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <StageEditor
          canManage={canManage}
          stages={stages.map((s) => ({
            id: s.id,
            key: s.key,
            name: s.name,
            description: s.description,
            category: s.category,
            color: s.color,
            position: s.position,
            isDefault: s.isDefault,
            isActive: s.isActive,
            staleAfterHours: s.staleAfterHours,
            clientCount: countByStage.get(s.id) ?? 0,
          }))}
        />
      </CardContent>
    </Card>
  );
}
