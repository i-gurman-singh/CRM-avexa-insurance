import Link from 'next/link';
import { BotIcon, FileTextIcon } from 'lucide-react';
import { db } from '@/lib/db';
import { can } from '@/lib/rbac';
import { cn } from '@/lib/utils';
import { formatDate, timeAgo } from '@/lib/dates';
import { requireAuth } from '@/core/auth/session';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@/ui/components/primitives';

export const metadata = { title: 'Documents' };
export const dynamic = 'force-dynamic';

/**
 * Document queues across all clients.
 *
 * Two things staff need centrally: what has AI read that nobody has checked,
 * and who are we still waiting on. Everything else happens on the client
 * profile.
 */

const FILTERS = [
  { key: 'review', label: 'Needs verification' },
  { key: 'outstanding', label: 'Outstanding requests' },
  { key: 'recent', label: 'Recently received' },
  { key: 'failed', label: 'Processing failed' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const user = await requireAuth();
  const { filter: rawFilter } = await searchParams;
  const filter = (FILTERS.find((f) => f.key === rawFilter)?.key ?? 'review') as FilterKey;

  const canDownload = can({ role: user.role, permissionOverrides: user.permissionOverrides }, 'documents.download');

  const [counts, documents, outstanding] = await Promise.all([
    Promise.all([
      db.document.count({
        where: { verificationStatus: { in: ['UNVERIFIED', 'NEEDS_REVIEW'] }, processingStatus: 'PROCESSED' },
      }),
      db.documentChecklistItem.count({
        where: { required: true, status: { in: ['NOT_REQUESTED', 'REQUESTED'] }, client: { isArchived: false, stage: { category: 'OPEN' } } },
      }),
      db.document.count({ where: { receivedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
      db.document.count({ where: { processingStatus: 'FAILED' } }),
    ]),

    filter === 'outstanding'
      ? Promise.resolve([])
      : db.document.findMany({
          where:
            filter === 'review'
              ? { verificationStatus: { in: ['UNVERIFIED', 'NEEDS_REVIEW'] }, processingStatus: 'PROCESSED' }
              : filter === 'failed'
                ? { processingStatus: 'FAILED' }
                : {},
          orderBy: { receivedAt: 'desc' },
          take: 100,
          include: {
            documentType: true,
            client: { select: { id: true, displayName: true } },
            extractions: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        }),

    filter === 'outstanding'
      ? db.documentChecklistItem.findMany({
          where: {
            required: true,
            status: { in: ['NOT_REQUESTED', 'REQUESTED'] },
            client: { isArchived: false, stage: { category: 'OPEN' } },
          },
          orderBy: [{ lastRequestedAt: 'asc' }],
          take: 200,
          include: {
            documentType: true,
            client: {
              select: { id: true, displayName: true, stage: { select: { name: true, color: true } } },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const [reviewCount, outstandingCount, recentCount, failedCount] = counts;
  const countFor: Record<FilterKey, number> = {
    review: reviewCount,
    outstanding: outstandingCount,
    recent: recentCount,
    failed: failedCount,
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Documents"
        description="Everything clients have sent, and everything we are still waiting for."
      />

      <nav className="flex flex-wrap gap-1.5" aria-label="Document filters">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/documents?filter=${f.key}`}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
              f.key === filter
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-surface text-muted-foreground hover:bg-accent',
            )}
          >
            {f.label}
            {countFor[f.key] > 0 ? (
              <span
                className={cn(
                  'rounded-full px-1.5 text-[10px] tabular-nums',
                  f.key === filter ? 'bg-white/20' : 'bg-surface-muted',
                )}
              >
                {countFor[f.key]}
              </span>
            ) : null}
          </Link>
        ))}
      </nav>

      <Card>
        <CardContent className="p-0">
          {filter === 'outstanding' ? (
            outstanding.length === 0 ? (
              <EmptyState
                icon={<FileTextIcon className="size-7" />}
                title="Nothing outstanding"
                description="Every open client has sent what we asked for."
              />
            ) : (
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Client</TH>
                    <TH>Document</TH>
                    <TH>Stage</TH>
                    <TH>Asked</TH>
                    <TH>Last request</TH>
                  </TR>
                </THead>
                <TBody>
                  {outstanding.map((item) => (
                    <TR key={item.id}>
                      <TD>
                        <Link href={`/clients/${item.clientId}?tab=documents`} className="text-sm font-medium hover:underline">
                          {item.client.displayName}
                        </Link>
                      </TD>
                      <TD className="text-sm">{item.documentType.name}</TD>
                      <TD>
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px]"
                          style={{
                            backgroundColor: `${item.client.stage.color}1a`,
                            color: item.client.stage.color,
                          }}
                        >
                          {item.client.stage.name}
                        </span>
                      </TD>
                      <TD className="text-xs text-muted-foreground">
                        {item.requestCount === 0 ? 'Never' : `${item.requestCount}×`}
                      </TD>
                      <TD className="text-xs text-muted-foreground">
                        {item.lastRequestedAt ? timeAgo(item.lastRequestedAt) : '—'}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )
          ) : documents.length === 0 ? (
            <EmptyState
              icon={<FileTextIcon className="size-7" />}
              title="Nothing here"
              description={
                filter === 'review'
                  ? 'Every processed document has been checked by a person.'
                  : 'No documents match this filter.'
              }
            />
          ) : (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Document</TH>
                  <TH>Client</TH>
                  <TH>Type</TH>
                  <TH className="hidden md:table-cell">AI confidence</TH>
                  <TH>Status</TH>
                  <TH className="hidden sm:table-cell">Received</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {documents.map((doc) => {
                  const extraction = doc.extractions[0];
                  return (
                    <TR key={doc.id}>
                      <TD className="max-w-[14rem] truncate text-sm">{doc.filename}</TD>
                      <TD>
                        <Link
                          href={`/clients/${doc.clientId}?tab=documents`}
                          className="text-sm hover:underline"
                        >
                          {doc.client.displayName}
                        </Link>
                      </TD>
                      <TD className="text-xs">
                        {doc.documentType?.name ?? (
                          <span className="text-muted-foreground">Unclassified</span>
                        )}
                      </TD>
                      <TD className="hidden md:table-cell">
                        {extraction?.confidence !== null && extraction?.confidence !== undefined ? (
                          <Badge
                            tone={
                              extraction.confidence >= 0.9
                                ? 'success'
                                : extraction.confidence >= 0.7
                                  ? 'warning'
                                  : 'critical'
                            }
                            className="gap-1"
                          >
                            <BotIcon className="size-2.5" aria-hidden />
                            {Math.round(extraction.confidence * 100)}%
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TD>
                      <TD>
                        {doc.processingStatus === 'FAILED' ? (
                          <Badge tone="critical">Failed</Badge>
                        ) : doc.verificationStatus === 'NEEDS_REVIEW' ? (
                          <Badge tone="warning">Needs review</Badge>
                        ) : doc.verificationStatus === 'VERIFIED' ? (
                          <Badge tone="success">Verified</Badge>
                        ) : (
                          <Badge tone="neutral">Unverified</Badge>
                        )}
                      </TD>
                      <TD className="hidden sm:table-cell text-xs text-muted-foreground">
                        {formatDate(doc.receivedAt)}
                      </TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-1">
                          {canDownload ? (
                            <Button asChild variant="ghost" size="sm">
                              <a href={`/api/documents/${doc.id}/download?inline=1`} target="_blank" rel="noreferrer">
                                View
                              </a>
                            </Button>
                          ) : null}
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/clients/${doc.clientId}?tab=documents`}>Review</Link>
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
