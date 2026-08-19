import { requireAuth } from '@/core/auth/session';
import { getPipelineBoard } from '@/core/pipeline/service';
import { listAssignableUsers } from '@/core/users/service';
import { PageHeader } from '@/ui/components/primitives';
import { PipelineBoard, type BoardColumn } from './pipeline-board';
import { PipelineFilters } from './pipeline-filters';

export const metadata = { title: 'Pipeline' };
export const dynamic = 'force-dynamic';

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ assignee?: string; q?: string }>;
}) {
  const user = await requireAuth();
  const { assignee, q } = await searchParams;

  const assignedUserId = assignee === 'me' ? user.id : assignee && assignee !== 'all' ? assignee : undefined;

  const [board, users] = await Promise.all([
    getPipelineBoard({ assignedUserId, search: q, limitPerStage: 40 }),
    listAssignableUsers(),
  ]);

  // Shape for the client component: only what it renders, serialised.
  const columns: BoardColumn[] = board.map((column) => ({
    stage: {
      id: column.stage.id,
      key: column.stage.key,
      name: column.stage.name,
      color: column.stage.color,
      category: column.stage.category,
    },
    total: column.total,
    clients: column.clients.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      phone: c.phone,
      stageId: c.stageId,
      unreadCount: c.unreadCount,
      needsAttention: c.needsAttention,
      attentionReason: c.attentionReason,
      lastActivityAt: c.lastActivityAt.toISOString(),
      assignedUser: c.assignedUser
        ? { id: c.assignedUser.id, name: c.assignedUser.name, avatarUrl: c.assignedUser.avatarUrl }
        : null,
      quoteCount: c._count.quotes,
    })),
  }));

  const totalClients = board.reduce((sum, c) => sum + c.total, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pipeline"
        description={`${totalClients} client${totalClients === 1 ? '' : 's'}. Drag a card, or use the dropdown on it, to change stage.`}
        actions={<PipelineFilters users={users} currentAssignee={assignee ?? 'all'} query={q ?? ''} />}
      />

      <PipelineBoard columns={columns} />
    </div>
  );
}
