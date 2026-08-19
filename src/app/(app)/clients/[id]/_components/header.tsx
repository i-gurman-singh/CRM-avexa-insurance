'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  ArchiveIcon,
  CheckIcon,
  FileTextIcon,
  MailIcon,
  PhoneIcon,
  UserIcon,
} from 'lucide-react';
import { formatPhone } from '@/lib/utils';
import { assignClientAction, moveStageAction } from '@/server/actions/clients';
import { requestDocumentsAction } from '@/server/actions/messaging';
import { Avatar, Badge, Button, Select } from '@/ui/components/primitives';

/**
 * Client profile header: identity, stage, assignee and the two actions staff
 * reach for most (call, ask for documents).
 *
 * Moving to a stage in the LOST category prompts for a reason — capturing why
 * business is lost is what makes the lost-business analytics worth anything.
 */
export function ClientHeader({
  client,
  stages,
  users,
  lostReasons,
  outstandingDocumentCount,
}: {
  client: {
    id: string;
    displayName: string;
    phone: string;
    email: string | null;
    stageId: string;
    assignedUserId: string | null;
    reference: number;
    unreadCount: number;
    needsAttention: boolean;
    attentionReason: string | null;
    isArchived: boolean;
    assignedUser: { name: string; avatarUrl: string | null } | null;
  };
  stages: Array<{ id: string; name: string; color: string; category: string }>;
  users: Array<{ id: string; name: string }>;
  lostReasons: Array<{ id: string; name: string }>;
  outstandingDocumentCount: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingLostStage, setPendingLostStage] = useState<string | null>(null);
  const [lostReasonId, setLostReasonId] = useState('');
  const [lostNotes, setLostNotes] = useState('');

  const currentStage = stages.find((s) => s.id === client.stageId);

  function changeStage(toStageId: string) {
    const target = stages.find((s) => s.id === toStageId);
    if (target?.category === 'LOST') {
      setPendingLostStage(toStageId);
      return;
    }
    commitStage(toStageId);
  }

  function commitStage(toStageId: string, extra: { lostReasonId?: string; lostNotes?: string } = {}) {
    setError(null);
    startTransition(async () => {
      const result = await moveStageAction(client.id, toStageId, extra);
      if (!result.ok) setError(result.error);
      setPendingLostStage(null);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{client.displayName}</h1>
            <Badge tone="outline" className="font-mono text-[10px]">
              #{client.reference}
            </Badge>
            {client.unreadCount > 0 ? (
              <Badge tone="primary">{client.unreadCount} unread</Badge>
            ) : null}
            {client.isArchived ? <Badge tone="neutral">Archived</Badge> : null}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <a href={`tel:${client.phone}`} className="flex items-center gap-1.5 hover:text-foreground">
              <PhoneIcon className="size-3.5" aria-hidden />
              {formatPhone(client.phone)}
            </a>
            {client.email ? (
              <a href={`mailto:${client.email}`} className="flex items-center gap-1.5 hover:text-foreground">
                <MailIcon className="size-3.5" aria-hidden />
                {client.email}
              </a>
            ) : null}
            <span className="flex items-center gap-1.5">
              <UserIcon className="size-3.5" aria-hidden />
              {client.assignedUser ? (
                <>
                  <Avatar name={client.assignedUser.name} src={client.assignedUser.avatarUrl} size="sm" />
                  {client.assignedUser.name}
                </>
              ) : (
                'Unassigned'
              )}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {outstandingDocumentCount > 0 ? (
            <Button
              variant="outline"
              size="sm"
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await requestDocumentsAction(client.id);
                  if (!result.ok) setError(result.error);
                  else if (result.data.sent) setStatus(`Asked for: ${result.data.requested.join(', ')}`);
                  else if (result.data.message)
                    setStatus('Outbound automation is off — a task was created instead.');
                })
              }
            >
              <FileTextIcon className="size-4" />
              Request {outstandingDocumentCount} document{outstandingDocumentCount === 1 ? '' : 's'}
            </Button>
          ) : null}

          <Button asChild variant="outline" size="sm">
            <Link href={`/clients/${client.id}?tab=conversation`}>Open chat</Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Stage</span>
          <Select
            value={client.stageId}
            disabled={pending}
            onChange={(e) => changeStage(e.target.value)}
            aria-label="Pipeline stage"
            className="h-8 w-auto min-w-44 text-xs"
            style={currentStage ? { borderColor: currentStage.color } : undefined}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Assigned to</span>
          <Select
            value={client.assignedUserId ?? ''}
            disabled={pending}
            onChange={(e) =>
              startTransition(async () => {
                const result = await assignClientAction(client.id, e.target.value || null);
                if (!result.ok) setError(result.error);
              })
            }
            aria-label="Assigned user"
            className="h-8 w-auto min-w-40 text-xs"
          >
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </label>

        {client.needsAttention && client.attentionReason ? (
          <Badge tone="critical">{client.attentionReason}</Badge>
        ) : null}
      </div>

      {pendingLostStage ? (
        <div className="rounded-md border border-border bg-surface-muted p-3">
          <p className="text-sm font-medium">Why was this business lost?</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Recording the reason is what makes the lost-business report useful.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Select
              value={lostReasonId}
              onChange={(e) => setLostReasonId(e.target.value)}
              aria-label="Lost reason"
              className="h-8 w-auto min-w-44 text-xs"
            >
              <option value="">Choose a reason…</option>
              {lostReasons.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
            <input
              value={lostNotes}
              onChange={(e) => setLostNotes(e.target.value)}
              placeholder="Optional note"
              aria-label="Lost notes"
              className="h-8 flex-1 min-w-40 rounded-md border border-input bg-surface px-2 text-xs"
            />
            <Button
              size="sm"
              disabled={!lostReasonId}
              loading={pending}
              onClick={() => commitStage(pendingLostStage, { lostReasonId, lostNotes })}
            >
              <CheckIcon className="size-3.5" />
              Confirm
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPendingLostStage(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-md bg-critical-subtle px-3 py-2 text-xs text-critical" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="rounded-md bg-success-subtle px-3 py-2 text-xs text-success" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}

export function ArchiveButton({ clientId, archived }: { clientId: string; archived: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const { archiveClientAction } = await import('@/server/actions/clients');
          await archiveClientAction(clientId, !archived);
        })
      }
    >
      <ArchiveIcon className="size-4" />
      {archived ? 'Restore' : 'Archive'}
    </Button>
  );
}
