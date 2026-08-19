'use client';

import { useOptimistic, useState, useTransition } from 'react';
import Link from 'next/link';
import { AlertCircleIcon, GripVerticalIcon, MessageSquareIcon } from 'lucide-react';
import { cn, formatPhone } from '@/lib/utils';
import { timeAgo } from '@/lib/dates';
import { moveStageAction } from '@/server/actions/clients';
import { Avatar, Badge, Card } from '@/ui/components/primitives';

/**
 * Kanban pipeline.
 *
 * Uses native HTML5 drag-and-drop rather than a drag library: the interaction
 * is simple, it avoids a 40 kB dependency, and it degrades to the stage
 * dropdown on the client card for touch devices and keyboard users, which is
 * the accessible path anyway.
 *
 * The move is optimistic — the card jumps immediately and reverts if the
 * server rejects it, because waiting on a round trip makes dragging feel
 * broken.
 */

export interface BoardClient {
  id: string;
  displayName: string;
  phone: string;
  stageId: string;
  unreadCount: number;
  needsAttention: boolean;
  attentionReason: string | null;
  lastActivityAt: string;
  assignedUser: { id: string; name: string; avatarUrl: string | null } | null;
  quoteCount: number;
}

export interface BoardColumn {
  stage: { id: string; key: string; name: string; color: string; category: string };
  total: number;
  clients: BoardClient[];
}

export function PipelineBoard({ columns }: { columns: BoardColumn[] }) {
  const [pending, startTransition] = useTransition();
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [optimistic, applyOptimistic] = useOptimistic(
    columns,
    (state, move: { clientId: string; toStageId: string }) =>
      state.map((column) => {
        const without = column.clients.filter((c) => c.id !== move.clientId);
        if (column.stage.id !== move.toStageId) {
          return {
            ...column,
            clients: without,
            total: column.total - (column.clients.length - without.length),
          };
        }
        const moved = state.flatMap((c) => c.clients).find((c) => c.id === move.clientId);
        return {
          ...column,
          clients: moved ? [{ ...moved, stageId: move.toStageId }, ...without] : without,
          total: column.total + 1,
        };
      }),
  );

  function handleDrop(toStageId: string) {
    const clientId = dragging;
    setDragging(null);
    setDropTarget(null);
    if (!clientId) return;

    const current = optimistic.find((c) => c.clients.some((x) => x.id === clientId));
    if (current?.stage.id === toStageId) return;

    startTransition(async () => {
      applyOptimistic({ clientId, toStageId });
      const result = await moveStageAction(clientId, toStageId);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded-md bg-critical-subtle px-3 py-2 text-xs text-critical" role="alert">
          {error}
        </p>
      ) : null}

      <div
        className={cn(
          'flex gap-3 overflow-x-auto pb-4 scrollbar-thin',
          pending && 'pointer-events-none opacity-70',
        )}
      >
        {optimistic.map((column) => (
          <section
            key={column.stage.id}
            onDragOver={(e) => {
              e.preventDefault();
              setDropTarget(column.stage.id);
            }}
            onDragLeave={() => setDropTarget((t) => (t === column.stage.id ? null : t))}
            onDrop={() => handleDrop(column.stage.id)}
            aria-label={`${column.stage.name}, ${column.total} clients`}
            className={cn(
              'flex w-72 shrink-0 flex-col rounded-lg border bg-surface-muted/50 transition-colors',
              dropTarget === column.stage.id
                ? 'border-primary bg-primary-subtle/40'
                : 'border-border',
            )}
          >
            <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: column.stage.color }}
                aria-hidden
              />
              <h2 className="truncate text-xs font-semibold tracking-wide uppercase">
                {column.stage.name}
              </h2>
              <Badge tone="neutral" className="ml-auto px-1.5 py-0 text-[10px]">
                {column.total}
              </Badge>
            </header>

            <div className="flex-1 space-y-2 overflow-y-auto p-2 scrollbar-thin" style={{ maxHeight: '70vh' }}>
              {column.clients.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">Empty</p>
              ) : null}

              {column.clients.map((client) => (
                <Card
                  key={client.id}
                  draggable
                  onDragStart={() => setDragging(client.id)}
                  onDragEnd={() => {
                    setDragging(null);
                    setDropTarget(null);
                  }}
                  className={cn(
                    'group cursor-grab p-2.5 active:cursor-grabbing',
                    dragging === client.id && 'opacity-40',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <GripVerticalIcon
                      className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/clients/${client.id}`}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {client.displayName}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatPhone(client.phone)}
                      </p>

                      {client.needsAttention && client.attentionReason ? (
                        <p className="mt-1.5 flex items-start gap-1 text-[11px] text-critical">
                          <AlertCircleIcon className="mt-px size-3 shrink-0" aria-hidden />
                          <span className="line-clamp-2">{client.attentionReason}</span>
                        </p>
                      ) : null}

                      <div className="mt-2 flex items-center gap-2">
                        {client.unreadCount > 0 ? (
                          <Badge tone="primary" className="gap-1 px-1.5 py-0 text-[10px]">
                            <MessageSquareIcon className="size-2.5" aria-hidden />
                            {client.unreadCount}
                          </Badge>
                        ) : null}
                        {client.quoteCount > 0 ? (
                          <Badge tone="neutral" className="px-1.5 py-0 text-[10px]">
                            {client.quoteCount} quote{client.quoteCount === 1 ? '' : 's'}
                          </Badge>
                        ) : null}
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {timeAgo(client.lastActivityAt)}
                        </span>
                        {client.assignedUser ? (
                          <Avatar
                            name={client.assignedUser.name}
                            src={client.assignedUser.avatarUrl}
                            size="sm"
                          />
                        ) : null}
                      </div>

                      {/* Accessible / touch alternative to dragging. */}
                      <label className="mt-2 block">
                        <span className="sr-only">Move {client.displayName} to another stage</span>
                        <select
                          value={client.stageId}
                          onChange={(e) => {
                            const toStageId = e.target.value;
                            startTransition(async () => {
                              applyOptimistic({ clientId: client.id, toStageId });
                              const result = await moveStageAction(client.id, toStageId);
                              if (!result.ok) setError(result.error);
                            });
                          }}
                          className="w-full rounded border border-input bg-surface px-1.5 py-1 text-[11px] text-muted-foreground"
                        >
                          {columns.map((c) => (
                            <option key={c.stage.id} value={c.stage.id}>
                              {c.stage.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                </Card>
              ))}

              {column.total > column.clients.length ? (
                <Link
                  href={`/clients?stageIds=${column.stage.id}`}
                  className="block rounded-md px-2 py-2 text-center text-xs text-primary hover:bg-accent"
                >
                  View all {column.total}
                </Link>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
