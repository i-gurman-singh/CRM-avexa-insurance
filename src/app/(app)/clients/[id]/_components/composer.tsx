'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { SendIcon, SparklesIcon } from 'lucide-react';
import { markReadAction, sendMessageAction } from '@/server/actions/messaging';
import { Button, Textarea } from '@/ui/components/primitives';

/**
 * Reply box.
 *
 * A drafted reply from AI can be loaded into the box with one click, but it is
 * never pre-filled and never sent on its own — the person has to read it,
 * usually edit it, and press send. That is the whole point of "AI may suggest
 * replies".
 */
export function MessageComposer({
  clientId,
  conversationId,
  suggestedReply,
  canSend,
}: {
  clientId: string;
  conversationId: string | null;
  suggestedReply: string | null;
  canSend: boolean;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);

  // Opening the conversation clears the unread badge, which is what staff
  // expect — the badge means "nobody has looked at this", not "nobody replied".
  useEffect(() => {
    if (!conversationId) return;
    void markReadAction(clientId, conversationId);
  }, [clientId, conversationId]);

  function submit() {
    const value = text.trim();
    if (!value || pending) return;
    setError(null);

    startTransition(async () => {
      const result = await sendMessageAction(clientId, value);
      if (result.ok) {
        setText('');
        ref.current?.focus();
      } else {
        setError(result.error);
      }
    });
  }

  if (!canSend) {
    return (
      <div className="border-t border-border bg-surface-muted px-4 py-3 text-xs text-muted-foreground">
        You don&apos;t have permission to send messages.
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-surface p-3">
      {suggestedReply ? (
        <div className="mb-2 flex items-start gap-2 rounded-md bg-info-subtle px-3 py-2">
          <SparklesIcon className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-info">Suggested reply — review before sending</p>
            <p className="mt-0.5 text-xs">{suggestedReply}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setText(suggestedReply);
              ref.current?.focus();
            }}
          >
            Use
          </Button>
        </div>
      ) : null}

      {error ? (
        <p className="mb-2 rounded-md bg-critical-subtle px-3 py-2 text-xs text-critical" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex items-end gap-2">
        <Textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter makes a new line — the WhatsApp habit.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          maxLength={4096}
          placeholder="Type a message… (Enter to send, Shift+Enter for a new line)"
          aria-label="Message"
          className="min-h-[2.75rem] resize-none"
        />
        <Button onClick={submit} loading={pending} disabled={!text.trim()} size="lg" aria-label="Send">
          <SendIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}
