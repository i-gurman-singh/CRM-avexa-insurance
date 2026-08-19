'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { BotIcon, CheckIcon, MessageSquareIcon, PhoneIcon } from 'lucide-react';
import { formatDueDate, isOverdue } from '@/lib/dates';
import { cn, formatPhone } from '@/lib/utils';
import { completeFollowUpAction, snoozeFollowUpAction } from '@/server/actions/work';
import { Badge, Button, ColorBadge, Input, PriorityDot } from '@/ui/components/primitives';

export interface FollowUpRow {
  id: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  unreadCount: number;
  stageName: string;
  stageColor: string;
  reason: string;
  reasonKey: string;
  status: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  dueAt: string;
  notes: string | null;
  assignedName: string | null;
  createdBySystem: string;
}

export function FollowUpList({ followUps }: { followUps: FollowUpRow[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState<string | null>(null);
  const [outcome, setOutcome] = useState('');

  function snooze(id: string, days: number) {
    startTransition(async () => {
      const until = new Date(Date.now() + days * 86_400_000);
      until.setHours(10, 0, 0, 0);
      const result = await snoozeFollowUpAction(id, until.toISOString());
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <>
      {error ? (
        <p className="border-b border-border bg-critical-subtle px-4 py-2 text-xs text-critical" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-border">
        {followUps.map((followUp) => {
          const overdue = followUp.status === 'SCHEDULED' && isOverdue(followUp.dueAt);
          return (
            <li key={followUp.id} className={cn('px-4 py-3', overdue && 'bg-critical-subtle/30')}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/clients/${followUp.clientId}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {followUp.clientName}
                    </Link>
                    <ColorBadge color={followUp.stageColor}>{followUp.stageName}</ColorBadge>
                    {followUp.unreadCount > 0 ? (
                      <Badge tone="primary" className="gap-1 px-1.5 py-0 text-[10px]">
                        <MessageSquareIcon className="size-2.5" aria-hidden />
                        {followUp.unreadCount}
                      </Badge>
                    ) : null}
                    {followUp.createdBySystem !== 'manual' ? (
                      <Badge tone="info" className="gap-1 px-1.5 py-0 text-[10px]">
                        <BotIcon className="size-2.5" aria-hidden />
                        automated
                      </Badge>
                    ) : null}
                  </div>

                  <p className="mt-0.5 text-sm">{followUp.reason}</p>
                  {followUp.notes ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">{followUp.notes}</p>
                  ) : null}

                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <PriorityDot priority={followUp.priority} />
                    <span className={cn(overdue && 'font-medium text-critical')}>
                      {formatDueDate(followUp.dueAt)}
                    </span>
                    <a href={`tel:${followUp.clientPhone}`} className="flex items-center gap-1 hover:text-foreground">
                      <PhoneIcon className="size-3" aria-hidden />
                      {formatPhone(followUp.clientPhone)}
                    </a>
                    {followUp.assignedName ? <span>· {followUp.assignedName}</span> : null}
                    {followUp.status !== 'SCHEDULED' ? (
                      <Badge tone="neutral">{followUp.status.toLowerCase()}</Badge>
                    ) : null}
                  </div>
                </div>

                {followUp.status === 'SCHEDULED' ? (
                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/clients/${followUp.clientId}?tab=conversation`}>Open chat</Link>
                    </Button>
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => snooze(followUp.id, 1)}>
                      +1d
                    </Button>
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => snooze(followUp.id, 3)}>
                      +3d
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCompleting(completing === followUp.id ? null : followUp.id);
                        setOutcome('');
                      }}
                    >
                      <CheckIcon className="size-3.5" />
                      Done
                    </Button>
                  </div>
                ) : null}
              </div>

              {completing === followUp.id ? (
                <form
                  className="mt-3 flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    startTransition(async () => {
                      const result = await completeFollowUpAction(followUp.id, outcome || undefined);
                      if (!result.ok) setError(result.error);
                      setCompleting(null);
                    });
                  }}
                >
                  <Input
                    value={outcome}
                    onChange={(e) => setOutcome(e.target.value)}
                    placeholder="What happened? (optional)"
                    aria-label="Outcome"
                    autoFocus
                    className="h-8 flex-1 text-xs"
                  />
                  <Button type="submit" size="sm" loading={pending}>
                    Save
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setCompleting(null)}>
                    Cancel
                  </Button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
