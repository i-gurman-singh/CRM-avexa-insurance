'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  ArrowRightIcon,
  BotIcon,
  CheckIcon,
  FileTextIcon,
  MessageSquareIcon,
  XIcon,
} from 'lucide-react';
import { timeAgo } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { acceptSuggestionAction, rejectSuggestionAction } from '@/server/actions/documents';
import { Badge, Button, Card, CardContent, ColorBadge } from '@/ui/components/primitives';

export interface SuggestionRow {
  id: string;
  kind: string;
  confidence: number;
  rationale: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  clientId: string;
  clientName: string;
  stageName: string;
  stageColor: string;
  messageBody: string | null;
  documentName: string | null;
}

const KIND_LABELS: Record<string, string> = {
  STAGE_CHANGE: 'Move to a different stage',
  CREATE_TASK: 'Create a task',
  CREATE_FOLLOW_UP: 'Schedule a follow-up',
  REQUEST_DOCUMENT: 'Request documents',
  FIELD_UPDATE: 'Update a field',
  REPLY_DRAFT: 'Suggested reply',
  TAG_CONVERSATION: 'Label the conversation',
};

export function SuggestionList({ suggestions }: { suggestions: SuggestionRow[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [handled, setHandled] = useState<Set<string>>(new Set());

  function resolve(id: string, accept: boolean) {
    startTransition(async () => {
      const result = accept
        ? await acceptSuggestionAction(id)
        : await rejectSuggestionAction(id);
      if (result.ok) setHandled((s) => new Set(s).add(id));
      else setError(result.error);
    });
  }

  const visible = suggestions.filter((s) => !handled.has(s.id));

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded-md bg-critical-subtle px-3 py-2 text-xs text-critical" role="alert">
          {error}
        </p>
      ) : null}

      {visible.map((suggestion) => (
        <Card key={suggestion.id}>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="info" className="gap-1">
                    <BotIcon className="size-3" aria-hidden />
                    {KIND_LABELS[suggestion.kind] ?? suggestion.kind}
                  </Badge>
                  <Badge
                    tone={
                      suggestion.confidence >= 0.85
                        ? 'success'
                        : suggestion.confidence >= 0.6
                          ? 'warning'
                          : 'critical'
                    }
                  >
                    {Math.round(suggestion.confidence * 100)}% confident
                  </Badge>
                  <Link
                    href={`/clients/${suggestion.clientId}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {suggestion.clientName}
                  </Link>
                  <ColorBadge color={suggestion.stageColor}>{suggestion.stageName}</ColorBadge>
                  <span className="text-xs text-muted-foreground">{timeAgo(suggestion.createdAt)}</span>
                </div>

                <p className="mt-2 text-sm">{describe(suggestion)}</p>

                {suggestion.rationale ? (
                  <p className="mt-1 text-xs text-muted-foreground">{suggestion.rationale}</p>
                ) : null}

                {suggestion.messageBody ? (
                  <p className="mt-2 flex items-start gap-1.5 rounded-md bg-surface-muted px-2.5 py-1.5 text-xs text-muted-foreground">
                    <MessageSquareIcon className="mt-px size-3 shrink-0" aria-hidden />
                    <span className="line-clamp-2">{suggestion.messageBody}</span>
                  </p>
                ) : null}

                {suggestion.documentName ? (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <FileTextIcon className="size-3" aria-hidden />
                    {suggestion.documentName}
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => resolve(suggestion.id, true)}
                >
                  <CheckIcon className="size-3.5" />
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => resolve(suggestion.id, false)}
                >
                  <XIcon className="size-3.5" />
                  Reject
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      {visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          All caught up — every suggestion has been reviewed.
        </p>
      ) : null}
    </div>
  );
}

function describe(suggestion: SuggestionRow): string {
  const payload = suggestion.payload;

  switch (suggestion.kind) {
    case 'STAGE_CHANGE':
      return `Move from ${humanise(String(payload.fromStageKey ?? ''))} to ${humanise(String(payload.toStageKey ?? ''))}`;
    case 'FIELD_UPDATE':
      return `Set ${humanise(String(payload.target ?? payload.field ?? ''))} to "${String(payload.value ?? '')}"`;
    case 'REQUEST_DOCUMENT': {
      const ids = Array.isArray(payload.documentTypeIds) ? payload.documentTypeIds.length : 0;
      return `Ask the client for ${ids} outstanding document${ids === 1 ? '' : 's'}`;
    }
    case 'CREATE_TASK':
      return `Create task: ${String(payload.title ?? '')}`;
    case 'CREATE_FOLLOW_UP':
      return `Schedule a follow-up: ${humanise(String(payload.reasonKey ?? ''))}`;
    case 'REPLY_DRAFT':
      return String(payload.text ?? 'Draft reply');
    case 'TAG_CONVERSATION':
      return `Label the conversation "${humanise(String(payload.label ?? ''))}"`;
    default:
      return 'Suggested action';
  }
}

function humanise(value: string): string {
  return value.replace(/[_.]/g, ' ').trim();
}
