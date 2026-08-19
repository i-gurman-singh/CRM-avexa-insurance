'use client';

import { useRef, useState, useTransition } from 'react';
import {
  BotIcon,
  CheckIcon,
  CircleDashedIcon,
  DownloadIcon,
  EyeIcon,
  RefreshCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UploadIcon,
  XIcon,
} from 'lucide-react';
import { formatDate, timeAgo } from '@/lib/dates';
import { cn } from '@/lib/utils';
import {
  applyExtractionAction,
  deleteDocumentAction,
  reprocessDocumentAction,
  setChecklistStatusAction,
  setDocumentTypeAction,
  uploadDocumentAction,
  verifyDocumentAction,
} from '@/server/actions/documents';
import { requestDocumentsAction } from '@/server/actions/messaging';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Select,
} from '@/ui/components/primitives';

/**
 * Documents: the checklist, the files, and the AI's reading of them.
 *
 * The verification flow is the important part. AI proposes values; a person
 * sees them next to the document, with a confidence figure, and accepts or
 * rejects. Nothing extracted overwrites an existing value without that click.
 */

export interface ChecklistRow {
  id: string;
  name: string;
  documentTypeId: string;
  required: boolean;
  status: string;
  satisfied: boolean;
  requestCount: number;
  lastRequestedAt: string | null;
  receivedAt: string | null;
}

export interface DocumentRow {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  receivedAt: string;
  source: string;
  documentTypeId: string | null;
  documentTypeName: string | null;
  processingStatus: string;
  verificationStatus: string;
  detectedTypeKey: string | null;
  detectionConfidence: number | null;
  verifiedByName: string | null;
  extraction: {
    id: string;
    confidence: number | null;
    warnings: string[];
    appliedAt: string | null;
    fields: Record<string, { value: unknown; confidence: number }>;
  } | null;
}

export function DocumentsPanel({
  clientId,
  checklist,
  documents,
  documentTypes,
  canUpload,
  canVerify,
  canDownload,
  canDelete,
}: {
  clientId: string;
  checklist: ChecklistRow[];
  documents: DocumentRow[];
  documentTypes: Array<{ id: string; name: string }>;
  canUpload: boolean;
  canVerify: boolean;
  canDownload: boolean;
  canDelete: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const outstanding = checklist.filter((c) => c.required && !c.satisfied);
  const requiredCount = checklist.filter((c) => c.required).length;
  const doneCount = checklist.filter((c) => c.required && c.satisfied).length;

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-md bg-critical-subtle px-3 py-2 text-xs text-critical" role="alert">
          {error}
        </p>
      ) : null}

      {/* Checklist -------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Document checklist</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {doneCount} of {requiredCount} required document{requiredCount === 1 ? '' : 's'} received
            </p>
          </div>
          {outstanding.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await requestDocumentsAction(clientId);
                  if (!result.ok) setError(result.error);
                })
              }
            >
              Ask for {outstanding.length} missing
            </Button>
          ) : null}
        </CardHeader>

        <CardContent className="p-0">
          {checklist.length === 0 ? (
            <EmptyState title="No checklist yet" description="It is created when the client is quoted." />
          ) : (
            <ul className="divide-y divide-border">
              {checklist.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  {item.satisfied ? (
                    <CheckIcon className="size-4 shrink-0 text-success" aria-label="Received" />
                  ) : (
                    <CircleDashedIcon
                      className={cn(
                        'size-4 shrink-0',
                        item.required ? 'text-warning' : 'text-muted-foreground',
                      )}
                      aria-label="Outstanding"
                    />
                  )}

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{item.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {item.satisfied && item.receivedAt
                        ? `Received ${formatDate(item.receivedAt)}`
                        : item.requestCount > 0
                          ? `Asked ${item.requestCount}× · last ${timeAgo(item.lastRequestedAt!)}`
                          : 'Not requested yet'}
                    </span>
                  </span>

                  {!item.required ? <Badge tone="neutral">Optional</Badge> : null}
                  {item.status === 'VERIFIED' ? <Badge tone="success">Verified</Badge> : null}

                  {canVerify && !item.satisfied ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await setChecklistStatusAction(
                            clientId,
                            item.id,
                            'WAIVED',
                            'Not required for this client',
                          );
                          if (!result.ok) setError(result.error);
                        })
                      }
                    >
                      Waive
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Files ------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle>Files</CardTitle>
          {canUpload ? (
            <>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept="image/*,application/pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const data = new FormData();
                  data.set('file', file);
                  setError(null);
                  startTransition(async () => {
                    const result = await uploadDocumentAction(clientId, data);
                    if (!result.ok) setError(result.error);
                    if (fileRef.current) fileRef.current.value = '';
                  });
                }}
              />
              <Button size="sm" variant="outline" loading={pending} onClick={() => fileRef.current?.click()}>
                <UploadIcon className="size-3.5" />
                Upload
              </Button>
            </>
          ) : null}
        </CardHeader>

        <CardContent className="p-0">
          {documents.length === 0 ? (
            <EmptyState
              title="No documents yet"
              description="Anything the client sends on WhatsApp lands here automatically."
            />
          ) : (
            <ul className="divide-y divide-border">
              {documents.map((doc) => (
                <li key={doc.id} className="p-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{doc.filename}</span>
                        {doc.verificationStatus === 'VERIFIED' ? (
                          <Badge tone="success">Verified</Badge>
                        ) : doc.verificationStatus === 'REJECTED' ? (
                          <Badge tone="critical">Rejected</Badge>
                        ) : doc.verificationStatus === 'NEEDS_REVIEW' ? (
                          <Badge tone="warning">Needs review</Badge>
                        ) : (
                          <Badge tone="neutral">Unverified</Badge>
                        )}
                        {doc.processingStatus === 'FAILED' ? (
                          <Badge tone="critical">Processing failed</Badge>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDate(doc.receivedAt)} · {(doc.sizeBytes / 1024).toFixed(0)} KB · via{' '}
                        {doc.source}
                        {doc.verifiedByName ? ` · verified by ${doc.verifiedByName}` : ''}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1">
                      {canVerify ? (
                        <Select
                          value={doc.documentTypeId ?? ''}
                          aria-label={`Document type for ${doc.filename}`}
                          className="h-8 w-auto min-w-36 text-xs"
                          onChange={(e) =>
                            startTransition(async () => {
                              const result = await setDocumentTypeAction(
                                clientId,
                                doc.id,
                                e.target.value || null,
                              );
                              if (!result.ok) setError(result.error);
                            })
                          }
                        >
                          <option value="">Unclassified</option>
                          {documentTypes.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Badge tone="neutral">{doc.documentTypeName ?? 'Unclassified'}</Badge>
                      )}

                      {canDownload ? (
                        <>
                          <Button asChild variant="ghost" size="icon" aria-label="Preview">
                            <a href={`/api/documents/${doc.id}/download?inline=1`} target="_blank" rel="noreferrer">
                              <EyeIcon className="size-4" />
                            </a>
                          </Button>
                          <Button asChild variant="ghost" size="icon" aria-label="Download">
                            <a href={`/api/documents/${doc.id}/download`}>
                              <DownloadIcon className="size-4" />
                            </a>
                          </Button>
                        </>
                      ) : null}

                      {canVerify ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Re-run AI extraction"
                          title="Re-run AI extraction"
                          loading={pending}
                          onClick={() =>
                            startTransition(async () => {
                              await reprocessDocumentAction(clientId, doc.id);
                            })
                          }
                        >
                          <RefreshCwIcon className="size-4" />
                        </Button>
                      ) : null}

                      {canDelete ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Delete document"
                          loading={pending}
                          onClick={() =>
                            startTransition(async () => {
                              const result = await deleteDocumentAction(clientId, doc.id);
                              if (!result.ok) setError(result.error);
                            })
                          }
                        >
                          <Trash2Icon className="size-4 text-critical" />
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {doc.extraction ? (
                    <ExtractionReview
                      clientId={clientId}
                      documentId={doc.id}
                      extraction={doc.extraction}
                      canVerify={canVerify}
                      onError={setError}
                    />
                  ) : null}

                  {canVerify && doc.verificationStatus !== 'VERIFIED' ? (
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        loading={pending}
                        onClick={() =>
                          startTransition(async () => {
                            const result = await verifyDocumentAction(clientId, doc.id, 'VERIFIED');
                            if (!result.ok) setError(result.error);
                          })
                        }
                      >
                        <CheckIcon className="size-3.5" />
                        Mark verified
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={pending}
                        onClick={() =>
                          startTransition(async () => {
                            const result = await verifyDocumentAction(
                              clientId,
                              doc.id,
                              'REJECTED',
                              'Unreadable or wrong document',
                            );
                            if (!result.ok) setError(result.error);
                          })
                        }
                      >
                        <XIcon className="size-3.5" />
                        Reject
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ExtractionReview({
  clientId,
  documentId,
  extraction,
  canVerify,
  onError,
}: {
  clientId: string;
  documentId: string;
  extraction: NonNullable<DocumentRow['extraction']>;
  canVerify: boolean;
  onError: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const entries = Object.entries(extraction.fields);

  if (entries.length === 0 && extraction.warnings.length === 0) return null;

  return (
    <div className="mt-3 rounded-md border border-border bg-surface-muted/60 p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <BotIcon className="size-3.5 text-warning" aria-hidden />
        What AI read from this document
        {extraction.confidence !== null ? (
          <span className="text-muted-foreground">
            · {Math.round(extraction.confidence * 100)}% overall
          </span>
        ) : null}
        {extraction.appliedAt ? <Badge tone="success">Accepted</Badge> : null}
      </p>

      {extraction.warnings.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {extraction.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-1.5 text-[11px] text-warning">
              <TriangleAlertIcon className="mt-px size-3 shrink-0" aria-hidden />
              {warning}
            </li>
          ))}
        </ul>
      ) : null}

      {entries.length > 0 ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          {entries.map(([key, field]) => (
            <div key={key} className="min-w-0">
              <dt className="text-[11px] text-muted-foreground">{humanise(key)}</dt>
              <dd className="flex items-center gap-1.5">
                <span className="truncate text-xs">{String(field.value ?? '—')}</span>
                <span
                  className={cn(
                    'shrink-0 rounded px-1 text-[10px]',
                    field.confidence >= 0.9
                      ? 'bg-success-subtle text-success'
                      : field.confidence >= 0.7
                        ? 'bg-warning-subtle text-warning'
                        : 'bg-critical-subtle text-critical',
                  )}
                >
                  {Math.round(field.confidence * 100)}%
                </span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {canVerify && !extraction.appliedAt && entries.length > 0 ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await applyExtractionAction(clientId, documentId, extraction.id);
              if (!result.ok) onError(result.error);
            })
          }
        >
          <CheckIcon className="size-3.5" />
          Accept these values into the client record
        </Button>
      ) : null}
    </div>
  );
}

function humanise(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}
