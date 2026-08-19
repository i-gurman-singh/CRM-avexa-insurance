import { can } from '@/lib/rbac';
import { requireAuth } from '@/core/auth/session';
import {
  listAgeGroups,
  listInsuranceCompanies,
  listLeadSources,
  listLostReasons,
  listQuoteStatuses,
  listTaskTypes,
} from '@/core/settings/lookups';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/primitives';
import { AgeGroupEditor, ListEditor } from './list-editor';

export const metadata = { title: 'Lists & lookups' };
export const dynamic = 'force-dynamic';

/**
 * The configurable lists.
 *
 * Every one of these is a database row rather than a value in code, which is
 * the whole reason an administrator can add "Gore Mutual" or "TikTok" or
 * "Waiting on underwriter" at 9pm without filing a ticket.
 */
export default async function ListsSettingsPage() {
  const user = await requireAuth();
  const canManage = can(
    { role: user.role, permissionOverrides: user.permissionOverrides },
    'settings.manage',
  );

  const [companies, sources, reasons, taskTypes, quoteStatuses, ageGroups] = await Promise.all([
    listInsuranceCompanies(true),
    listLeadSources(true),
    listLostReasons(true),
    listTaskTypes(true),
    listQuoteStatuses(true),
    listAgeGroups(true),
  ]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Insurance companies</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The insurers you quote with. Deactivate rather than delete so past quotes and
              analytics stay intact.
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ListEditor
            kind="company"
            canManage={canManage}
            items={companies.map((c) => ({
              id: c.id,
              name: c.name,
              detail: c.code ?? undefined,
              isActive: c.isActive,
            }))}
            addLabel="Add a company"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Lead sources</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Where enquiries come from. These drive the source conversion report.
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ListEditor
            kind="leadSource"
            canManage={canManage}
            items={sources.map((s) => ({ id: s.id, name: s.name, detail: s.key, isActive: s.isActive }))}
            addLabel="Add a source"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Lost reasons</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Offered when a client is moved to a lost stage. Keep the list short — a long list
              gets picked at random and the report becomes meaningless.
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ListEditor
            kind="lostReason"
            canManage={canManage}
            items={reasons.map((r) => ({ id: r.id, name: r.name, detail: r.key, isActive: r.isActive }))}
            addLabel="Add a reason"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Task types</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Each type carries a default priority and due window, which is what automated tasks
              inherit.
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ListEditor
            kind="taskType"
            canManage={canManage}
            items={taskTypes.map((t) => ({
              id: t.id,
              name: t.name,
              detail: `${t.defaultPriority.toLowerCase()} · due in ${t.defaultDueInDays}d`,
              isActive: t.isActive,
            }))}
            addLabel="Add a task type"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Quote statuses</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              A status flagged &ldquo;provided&rdquo; counts as a quote the client has actually
              seen, which is what the conversion rate is measured against.
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ListEditor
            kind="quoteStatus"
            canManage={canManage}
            items={quoteStatuses.map((s) => ({
              id: s.id,
              name: s.name,
              detail: [s.isProvided ? 'provided' : null, s.isClosed ? 'closed' : null]
                .filter(Boolean)
                .join(' · '),
              color: s.color,
              isActive: s.isActive,
            }))}
            addLabel="Add a status"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Age groups</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The buckets used by the age analytics. Change them and the report recalculates — no
              data is lost, because ages are derived from date of birth at query time.
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <AgeGroupEditor
            canManage={canManage}
            groups={ageGroups.map((g) => ({
              id: g.id,
              name: g.name,
              minAge: g.minAge,
              maxAge: g.maxAge,
              isActive: g.isActive,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
