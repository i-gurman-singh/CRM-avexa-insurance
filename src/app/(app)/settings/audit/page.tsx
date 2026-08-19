import { redirect } from 'next/navigation';
import Link from 'next/link';
import { can } from '@/lib/rbac';
import { formatDateTime } from '@/lib/dates';
import { requireAuth } from '@/core/auth/session';
import { listAuditLogs } from '@/core/audit/service';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@/ui/components/primitives';

export const metadata = { title: 'Audit log' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;

/**
 * Audit log.
 *
 * Records who did what and when — including every time a client document was
 * downloaded or previewed, which for personal insurance data matters as much
 * as controlling who *can*.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; action?: string }>;
}) {
  const user = await requireAuth();
  if (!can({ role: user.role, permissionOverrides: user.permissionOverrides }, 'audit.view')) {
    redirect('/settings');
  }

  const { page: rawPage, action } = await searchParams;
  const page = Math.max(1, Number(rawPage ?? 1) || 1);

  const { items, total } = await listAuditLogs({
    action,
    take: PAGE_SIZE,
    skip: (page - 1) * PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Audit log</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {total.toLocaleString()} entries. Sensitive values are redacted — the log records that
            something happened and who did it, never a second copy of the client&apos;s data.
          </p>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <EmptyState title="No entries" description="Nothing has been recorded yet." />
        ) : (
          <>
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>When</TH>
                  <TH>Who</TH>
                  <TH>Action</TH>
                  <TH className="hidden md:table-cell">Record</TH>
                  <TH className="hidden lg:table-cell">Detail</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((entry) => (
                  <TR key={entry.id}>
                    <TD className="text-xs whitespace-nowrap text-muted-foreground">
                      {formatDateTime(entry.createdAt)}
                    </TD>
                    <TD className="text-xs">{entry.user?.name ?? 'System'}</TD>
                    <TD>
                      <Badge
                        tone={
                          entry.action.includes('delete')
                            ? 'critical'
                            : entry.action.includes('download') || entry.action.includes('view')
                              ? 'warning'
                              : entry.action.includes('bind')
                                ? 'success'
                                : 'neutral'
                        }
                        className="font-mono text-[10px]"
                      >
                        {entry.action}
                      </Badge>
                    </TD>
                    <TD className="hidden md:table-cell text-xs text-muted-foreground">
                      {entry.entityType}
                      {entry.entityId ? ` · ${entry.entityId.slice(0, 8)}` : ''}
                    </TD>
                    <TD className="hidden lg:table-cell max-w-md truncate text-xs text-muted-foreground">
                      {JSON.stringify(entry.metadata)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>

            {totalPages > 1 ? (
              <nav
                className="flex items-center justify-between border-t border-border px-4 py-3 text-xs"
                aria-label="Pagination"
              >
                <span className="text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <span className="flex gap-3">
                  {page > 1 ? (
                    <Link href={`/settings/audit?page=${page - 1}`} className="text-primary hover:underline">
                      Previous
                    </Link>
                  ) : null}
                  {page < totalPages ? (
                    <Link href={`/settings/audit?page=${page + 1}`} className="text-primary hover:underline">
                      Next
                    </Link>
                  ) : null}
                </span>
              </nav>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
