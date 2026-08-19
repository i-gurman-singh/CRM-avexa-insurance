import { requireAuth } from '@/core/auth/session';
import { listLeadSources, listStages } from '@/core/settings/lookups';
import { listAssignableUsers } from '@/core/users/service';
import { PageHeader } from '@/ui/components/primitives';
import { NewClientForm } from './new-client-form';

export const metadata = { title: 'New client' };
export const dynamic = 'force-dynamic';

export default async function NewClientPage() {
  await requireAuth();

  const [stages, sources, users] = await Promise.all([
    listStages(),
    listLeadSources(),
    listAssignableUsers(),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title="New client"
        description="Only a phone number is required — everything else can be filled in as you learn it, or extracted from documents the client sends."
      />
      <NewClientForm
        stages={stages.map((s) => ({ id: s.id, name: s.name, isDefault: s.isDefault }))}
        sources={sources.map((s) => ({ id: s.id, name: s.name }))}
        users={users}
      />
    </div>
  );
}
