import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { can } from '@/lib/rbac';
import type { UserRole } from '@/lib/types';
import { cn, toNumber } from '@/lib/utils';
import { requireAuth } from '@/core/auth/session';
import { getClient } from '@/core/clients/service';
import { getProvenanceMap, getProvenanceMapMany } from '@/core/clients/provenance';
import { listActivity } from '@/core/activity/service';
import { listNotes } from '@/core/clients/service';
import { listQuotes } from '@/core/quotes/service';
import { listPolicies } from '@/core/policies/service';
import { listDocuments } from '@/core/documents/service';
import { ensureChecklist } from '@/core/documents/checklist';
import { documentChecklistSummary } from '@/core/workflows/documentRequests';
import { getConversationForClient, listMessages } from '@/core/messaging/service';
import { listSuggestions } from '@/core/ai/suggestions';
import {
  listDocumentTypes,
  listInsuranceCompanies,
  listLostReasons,
  listQuoteStatuses,
  listStages,
} from '@/core/settings/lookups';
import { listAssignableUsers } from '@/core/users/service';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/primitives';
import { ClientHeader } from './_components/header';
import { ConversationPanel } from './_components/conversation';
import { DocumentsPanel } from './_components/documents';
import {
  AddDriverButton,
  AddVehicleButton,
  ClientDetailsForm,
  DriverCard,
  VehicleCard,
} from './_components/forms';
import { NotesPanel } from './_components/notes';
import { QuotesPanel } from './_components/quotes';
import { Timeline } from './_components/timeline';
import { ClientWorkPanel } from './_components/work';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'conversation', label: 'Conversation' },
  { key: 'quotes', label: 'Quotes & policies' },
  { key: 'documents', label: 'Documents' },
  { key: 'work', label: 'Tasks & follow-ups' },
  { key: 'activity', label: 'Activity' },
  { key: 'notes', label: 'Notes' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await db.client.findUnique({ where: { id }, select: { displayName: true } });
  return { title: client?.displayName ?? 'Client' };
}

/**
 * Client profile.
 *
 * Tabs are URL-driven (`?tab=conversation`) rather than React state, which
 * means each panel is a server component that only queries what it needs, and
 * a link to a specific tab is shareable. The cost is a navigation per tab
 * switch; the benefit is that opening a client never loads seven panels' worth
 * of data at once.
 */
export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab = (TABS.find((t) => t.key === rawTab)?.key ?? 'overview') as TabKey;

  const user = await requireAuth();
  const client = await getClient(id);
  if (!client) notFound();

  // Keep the checklist in step with the configured requirements. Cheap, and it
  // means a newly added document type appears on existing clients.
  await ensureChecklist(client.id).catch(() => undefined);

  const [stages, users, lostReasons, checklist] = await Promise.all([
    listStages(),
    listAssignableUsers(),
    listLostReasons(),
    documentChecklistSummary(client.id),
  ]);

  const outstanding = checklist.filter((c) => c.required && !c.satisfied).length;

  return (
    <div className="space-y-5">
      <ClientHeader
        client={{
          id: client.id,
          displayName: client.displayName,
          phone: client.phone,
          email: client.email,
          stageId: client.stageId,
          assignedUserId: client.assignedUserId,
          reference: client.reference,
          unreadCount: client.unreadCount,
          needsAttention: client.needsAttention,
          attentionReason: client.attentionReason,
          isArchived: client.isArchived,
          assignedUser: client.assignedUser
            ? { name: client.assignedUser.name, avatarUrl: client.assignedUser.avatarUrl }
            : null,
        }}
        stages={stages.map((s) => ({ id: s.id, name: s.name, color: s.color, category: s.category }))}
        users={users}
        lostReasons={lostReasons}
        outstandingDocumentCount={outstanding}
      />

      <nav className="flex gap-1 overflow-x-auto border-b border-border scrollbar-thin" aria-label="Client sections">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/clients/${client.id}?tab=${t.key}`}
            aria-current={tab === t.key ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors',
              tab === t.key
                ? 'border-primary font-medium text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            {t.key === 'documents' && outstanding > 0 ? (
              <span className="ml-1.5 rounded-full bg-warning-subtle px-1.5 py-0.5 text-[10px] text-warning">
                {outstanding}
              </span>
            ) : null}
            {t.key === 'conversation' && client.unreadCount > 0 ? (
              <span className="ml-1.5 rounded-full bg-primary-subtle px-1.5 py-0.5 text-[10px] text-primary">
                {client.unreadCount}
              </span>
            ) : null}
          </Link>
        ))}
      </nav>

      {tab === 'overview' ? <OverviewTab clientId={client.id} /> : null}
      {tab === 'conversation' ? <ConversationTab clientId={client.id} userRole={user.role} userOverrides={user.permissionOverrides} /> : null}
      {tab === 'quotes' ? <QuotesTab clientId={client.id} user={user} /> : null}
      {tab === 'documents' ? <DocumentsTab clientId={client.id} user={user} /> : null}
      {tab === 'work' ? <ClientWorkTab clientId={client.id} /> : null}
      {tab === 'activity' ? <ActivityTab clientId={client.id} /> : null}
      {tab === 'notes' ? <NotesTab clientId={client.id} user={user} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

async function OverviewTab({ clientId }: { clientId: string }) {
  const client = await getClient(clientId);
  if (!client) notFound();

  const driverIds = client.drivers.map((d) => d.id);
  const vehicleIds = client.vehicles.map((v) => v.id);

  const [clientProvenance, driverProvenance, vehicleProvenance] = await Promise.all([
    getProvenanceMap('client', clientId),
    getProvenanceMapMany('driver', driverIds),
    getProvenanceMapMany('vehicle', vehicleIds),
  ]);

  function scoped(map: Record<string, { source: string; confidence: number | null }>, entityId: string) {
    const out: Record<string, { source: never; confidence: number | null }> = {};
    for (const [key, value] of Object.entries(map)) {
      if (!key.startsWith(`${entityId}:`)) continue;
      out[key.slice(entityId.length + 1)] = value as never;
    }
    return out;
  }

  return (
    <div className="space-y-4">
      <ClientDetailsForm
        clientId={clientId}
        values={client as unknown as Record<string, unknown>}
        provenance={clientProvenance as never}
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Drivers</h2>
          <AddDriverButton clientId={clientId} />
        </div>
        {client.drivers.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No drivers recorded yet.
            </CardContent>
          </Card>
        ) : (
          client.drivers.map((driver) => (
            <DriverCard
              key={driver.id}
              clientId={clientId}
              driver={driver as unknown as never}
              provenance={scoped(driverProvenance as never, driver.id) as never}
            />
          ))
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Vehicles</h2>
          <AddVehicleButton clientId={clientId} />
        </div>
        {client.vehicles.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No vehicles recorded yet.
            </CardContent>
          </Card>
        ) : (
          client.vehicles.map((vehicle) => (
            <VehicleCard
              key={vehicle.id}
              clientId={clientId}
              vehicle={vehicle as unknown as never}
              provenance={scoped(vehicleProvenance as never, vehicle.id) as never}
            />
          ))
        )}
      </section>
    </div>
  );
}

async function ConversationTab({
  clientId,
  userRole,
  userOverrides,
}: {
  clientId: string;
  userRole: UserRole;
  userOverrides: Record<string, boolean>;
}) {
  const [conversation, messages, suggestions] = await Promise.all([
    getConversationForClient(clientId),
    listMessages(clientId, { take: 200 }),
    listSuggestions({ clientId, kind: 'REPLY_DRAFT', take: 1 }),
  ]);

  const suggestedReply = (suggestions[0]?.payload as { text?: string } | undefined)?.text ?? null;

  return (
    <ConversationPanel
      clientId={clientId}
      conversationId={conversation?.id ?? null}
      canSend={can({ role: userRole, permissionOverrides: userOverrides }, 'messages.send')}
      suggestedReply={suggestedReply}
      messages={messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        body: m.body,
        contentType: m.contentType,
        sentAt: m.sentAt,
        deliveryStatus: m.deliveryStatus,
        isAutomated: m.isAutomated,
        errorMessage: m.errorMessage,
        sentByUser: m.sentByUser ? { name: m.sentByUser.name } : null,
        attachments: m.attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
        })),
        documents: m.documents.map((d) => ({
          id: d.id,
          filename: d.filename,
          mimeType: d.mimeType,
        })),
        analysis: m.analysis
          ? {
              intent: m.analysis.intent,
              confidence: m.analysis.confidence,
              sentiment: m.analysis.sentiment,
              summary: m.analysis.summary,
            }
          : null,
      }))}
    />
  );
}

async function QuotesTab({
  clientId,
  user,
}: {
  clientId: string;
  user: { role: UserRole; permissionOverrides: Record<string, boolean> };
}) {
  const subject = { role: user.role, permissionOverrides: user.permissionOverrides };

  const [quotes, policies, companies, statuses] = await Promise.all([
    listQuotes(clientId),
    listPolicies(clientId),
    listInsuranceCompanies(),
    listQuoteStatuses(),
  ]);

  return (
    <div className="space-y-4">
      <QuotesPanel
        clientId={clientId}
        canEdit={can(subject, 'quotes.create')}
        canSelect={can(subject, 'quotes.select')}
        companies={companies.map((c) => ({ id: c.id, name: c.name }))}
        statuses={statuses.map((s) => ({ id: s.id, name: s.name }))}
        quotes={quotes.map((q) => ({
          id: q.id,
          company: q.insuranceCompany.name,
          companyId: q.insuranceCompanyId,
          statusName: q.status.name,
          statusColor: q.status.color,
          monthlyPremium: toNumber(q.monthlyPremium),
          annualPremium: toNumber(q.annualPremium),
          coverageType: q.coverageType,
          liabilityLimit: toNumber(q.liabilityLimit),
          collisionDeductible: toNumber(q.collisionDeductible),
          telematics: q.telematics,
          isSelected: q.isSelected,
          sentToClientAt: q.sentToClientAt?.toISOString() ?? null,
          quoteDate: q.quoteDate.toISOString(),
          notes: q.notes,
        }))}
      />

      <Card>
        <CardHeader>
          <CardTitle>Policies</CardTitle>
        </CardHeader>
        <CardContent>
          {policies.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No policy yet. Once the client picks a quote, a broker can create and bind the policy.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {policies.map((policy) => (
                <li key={policy.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{policy.insuranceCompany.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {policy.policyNumber ?? 'No policy number'} ·{' '}
                      {policy.status.toLowerCase().replace(/_/g, ' ')}
                    </span>
                  </span>
                  <span className="text-sm tabular-nums">
                    {toNumber(policy.monthlyPremium)
                      ? `$${toNumber(policy.monthlyPremium)!.toFixed(2)}/mo`
                      : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

async function DocumentsTab({
  clientId,
  user,
}: {
  clientId: string;
  user: { role: UserRole; permissionOverrides: Record<string, boolean> };
}) {
  const subject = { role: user.role, permissionOverrides: user.permissionOverrides };

  const [checklist, documents, documentTypes] = await Promise.all([
    documentChecklistSummary(clientId),
    listDocuments(clientId),
    listDocumentTypes(),
  ]);

  return (
    <DocumentsPanel
      clientId={clientId}
      canUpload={can(subject, 'documents.upload')}
      canVerify={can(subject, 'documents.verify')}
      canDownload={can(subject, 'documents.download')}
      canDelete={can(subject, 'documents.delete')}
      documentTypes={documentTypes.map((t) => ({ id: t.id, name: t.name }))}
      checklist={checklist.map((c) => ({
        ...c,
        lastRequestedAt: c.lastRequestedAt?.toISOString() ?? null,
        receivedAt: c.receivedAt?.toISOString() ?? null,
      }))}
      documents={documents.map((d) => ({
        id: d.id,
        filename: d.filename,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        receivedAt: d.receivedAt.toISOString(),
        source: d.source,
        documentTypeId: d.documentTypeId,
        documentTypeName: d.documentType?.name ?? null,
        processingStatus: d.processingStatus,
        verificationStatus: d.verificationStatus,
        detectedTypeKey: d.detectedTypeKey,
        detectionConfidence: d.detectionConfidence,
        verifiedByName: d.verifiedByUser?.name ?? null,
        extraction: d.extractions[0]
          ? {
              id: d.extractions[0].id,
              confidence: d.extractions[0].confidence,
              warnings: d.extractions[0].warnings,
              appliedAt: d.extractions[0].appliedAt?.toISOString() ?? null,
              fields: d.extractions[0].fields as never,
            }
          : null,
      }))}
    />
  );
}

async function ClientWorkTab({ clientId }: { clientId: string }) {
  const [tasks, followUps, users] = await Promise.all([
    db.task.findMany({
      where: { clientId },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
      include: { assignedUser: { select: { name: true } }, taskType: true },
    }),
    db.followUp.findMany({
      where: { clientId },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
      include: { assignedUser: { select: { name: true } } },
    }),
    listAssignableUsers(),
  ]);

  return (
    <ClientWorkPanel
      clientId={clientId}
      users={users}
      tasks={tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        dueAt: t.dueAt?.toISOString() ?? null,
        assignedName: t.assignedUser?.name ?? null,
        createdBySystem: t.createdBySystem,
      }))}
      followUps={followUps.map((f) => ({
        id: f.id,
        reason: f.reason ?? f.reasonKey.replace(/_/g, ' '),
        reasonKey: f.reasonKey,
        status: f.status,
        priority: f.priority,
        dueAt: f.dueAt.toISOString(),
        assignedName: f.assignedUser?.name ?? null,
        createdBySystem: f.createdBySystem,
      }))}
    />
  );
}

async function ActivityTab({ clientId }: { clientId: string }) {
  const events = await listActivity(clientId, { take: 200 });
  return (
    <Timeline
      events={events.map((e) => ({
        id: e.id,
        type: e.type,
        title: e.title,
        body: e.body,
        createdAt: e.createdAt,
        actorType: e.actorType,
        actorUser: e.actorUser ? { name: e.actorUser.name } : null,
      }))}
    />
  );
}

async function NotesTab({
  clientId,
  user,
}: {
  clientId: string;
  user: { role: UserRole; permissionOverrides: Record<string, boolean> };
}) {
  const notes = await listNotes(clientId);
  return (
    <NotesPanel
      clientId={clientId}
      canDelete={can({ role: user.role, permissionOverrides: user.permissionOverrides }, 'notes.delete')}
      notes={notes.map((n) => ({
        id: n.id,
        body: n.body,
        isPinned: n.isPinned,
        createdAt: n.createdAt.toISOString(),
        author: n.author ? { id: n.author.id, name: n.author.name, avatarUrl: n.author.avatarUrl } : null,
      }))}
    />
  );
}
