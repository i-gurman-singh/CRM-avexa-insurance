import {
  CheckCheckIcon,
  CheckIcon,
  ClockIcon,
  FileIcon,
  ImageIcon,
  MicIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { formatChatDay, formatTime } from '@/lib/dates';
import { cn } from '@/lib/utils';
import type { MessageDeliveryStatus } from '@/lib/types';
import { Badge } from '@/ui/components/primitives';
import { MessageComposer } from './composer';

/**
 * WhatsApp conversation, rendered as a chat.
 *
 * Inbound on the left, outbound on the right, day separators, delivery ticks,
 * and — the part that makes this a CRM rather than a chat client — the AI's
 * reading of each inbound message shown inline, so staff can see at a glance
 * why the CRM did what it did.
 */

export interface ChatMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  body: string | null;
  contentType: string;
  sentAt: Date;
  deliveryStatus: MessageDeliveryStatus;
  isAutomated: boolean;
  errorMessage: string | null;
  sentByUser: { name: string } | null;
  attachments: Array<{ id: string; filename: string | null; mimeType: string | null }>;
  documents: Array<{ id: string; filename: string; mimeType: string }>;
  analysis: {
    intent: string;
    confidence: number;
    sentiment: string | null;
    summary: string | null;
  } | null;
}

export function ConversationPanel({
  clientId,
  conversationId,
  messages,
  suggestedReply,
  canSend,
}: {
  clientId: string;
  conversationId: string | null;
  messages: ChatMessage[];
  suggestedReply: string | null;
  canSend: boolean;
}) {
  const groups = groupByDay(messages);

  return (
    <div className="flex h-[calc(100dvh-16rem)] min-h-[420px] flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex-1 space-y-4 overflow-y-auto p-4 scrollbar-thin">
        {messages.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No messages yet. Anything you send here goes to the client&apos;s WhatsApp.
          </p>
        ) : null}

        {groups.map((group) => (
          <div key={group.day} className="space-y-2">
            <div className="sticky top-0 z-10 flex justify-center">
              <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-[11px] text-muted-foreground">
                {group.day}
              </span>
            </div>

            {group.messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </div>
        ))}
      </div>

      <MessageComposer
        clientId={clientId}
        conversationId={conversationId}
        suggestedReply={suggestedReply}
        canSend={canSend}
      />
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const inbound = message.direction === 'INBOUND';

  return (
    <div className={cn('flex', inbound ? 'justify-start' : 'justify-end')}>
      <div className={cn('max-w-[80%] sm:max-w-[65%]', inbound ? 'items-start' : 'items-end')}>
        <div
          className={cn(
            'px-3 py-2 text-sm',
            inbound
              ? 'bubble-in bg-surface-muted text-foreground'
              : 'bubble-out bg-primary text-primary-foreground',
          )}
        >
          {message.body ? (
            <p className="whitespace-pre-wrap break-words">{message.body}</p>
          ) : (
            <p className="flex items-center gap-1.5 italic opacity-80">
              <AttachmentIcon contentType={message.contentType} />
              {describeContent(message.contentType)}
            </p>
          )}

          {message.documents.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {message.documents.map((doc) => (
                <li key={doc.id}>
                  <a
                    href={`/api/documents/${doc.id}/download?inline=1`}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      'flex items-center gap-1.5 rounded px-1.5 py-1 text-xs underline-offset-2 hover:underline',
                      inbound ? 'bg-surface' : 'bg-white/15',
                    )}
                  >
                    <FileIcon className="size-3" aria-hidden />
                    <span className="truncate">{doc.filename}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div
          className={cn(
            'mt-0.5 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground',
            inbound ? 'justify-start' : 'justify-end',
          )}
        >
          {!inbound && message.isAutomated ? <span title="Sent by automation">auto</span> : null}
          {!inbound && message.sentByUser ? <span>{message.sentByUser.name}</span> : null}
          <time dateTime={message.sentAt.toISOString()}>{formatTime(message.sentAt)}</time>
          {!inbound ? <DeliveryTicks status={message.deliveryStatus} /> : null}
        </div>

        {message.errorMessage ? (
          <p className="mt-0.5 flex items-center gap-1 px-1 text-[11px] text-critical">
            <TriangleAlertIcon className="size-3" aria-hidden />
            {message.errorMessage}
          </p>
        ) : null}

        {inbound && message.analysis ? (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 px-1">
            <Badge
              tone={message.analysis.confidence >= 0.7 ? 'info' : 'warning'}
              className="px-1.5 py-0 text-[10px]"
              title={
                message.analysis.summary ??
                `AI read this as "${message.analysis.intent.replace(/_/g, ' ')}"`
              }
            >
              {message.analysis.intent.replace(/_/g, ' ')} ·{' '}
              {Math.round(message.analysis.confidence * 100)}%
            </Badge>
            {message.analysis.sentiment === 'negative' ? (
              <Badge tone="critical" className="px-1.5 py-0 text-[10px]">
                negative
              </Badge>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DeliveryTicks({ status }: { status: MessageDeliveryStatus }) {
  switch (status) {
    case 'PENDING':
      return <ClockIcon className="size-3" aria-label="Sending" />;
    case 'SENT':
      return <CheckIcon className="size-3" aria-label="Sent" />;
    case 'DELIVERED':
      return <CheckCheckIcon className="size-3" aria-label="Delivered" />;
    case 'READ':
      return <CheckCheckIcon className="size-3 text-info" aria-label="Read" />;
    case 'FAILED':
      return <TriangleAlertIcon className="size-3 text-critical" aria-label="Failed to send" />;
    default:
      return null;
  }
}

function AttachmentIcon({ contentType }: { contentType: string }) {
  if (contentType === 'IMAGE') return <ImageIcon className="size-3.5" aria-hidden />;
  if (contentType === 'AUDIO') return <MicIcon className="size-3.5" aria-hidden />;
  return <FileIcon className="size-3.5" aria-hidden />;
}

function describeContent(contentType: string): string {
  switch (contentType) {
    case 'IMAGE':
      return 'Photo';
    case 'DOCUMENT':
      return 'Document';
    case 'AUDIO':
      return 'Voice message';
    case 'VIDEO':
      return 'Video';
    case 'LOCATION':
      return 'Shared a location';
    case 'CONTACT':
      return 'Shared a contact';
    case 'STICKER':
      return 'Sticker';
    default:
      return 'Message';
  }
}

function groupByDay(messages: ChatMessage[]) {
  const groups: Array<{ day: string; messages: ChatMessage[] }> = [];
  for (const message of messages) {
    const day = formatChatDay(message.sentAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.messages.push(message);
    else groups.push({ day, messages: [message] });
  }
  return groups;
}
