'use client';

import { useState, useTransition } from 'react';
import { PinIcon, Trash2Icon } from 'lucide-react';
import { timeAgo } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { addNoteAction, deleteNoteAction, toggleNotePinAction } from '@/server/actions/clients';
import {
  Avatar,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  Textarea,
} from '@/ui/components/primitives';

/**
 * Internal notes.
 *
 * Never shown to the client — the model has an `isInternal` flag so a future
 * client portal could expose a subset, but everything written here is staff-only
 * by default. Pinned notes stay at the top, which is where "always mention the
 * spouse's policy" belongs.
 */

export interface NoteRow {
  id: string;
  body: string;
  isPinned: boolean;
  createdAt: string;
  author: { id: string; name: string; avatarUrl: string | null } | null;
}

export function NotesPanel({
  clientId,
  notes,
  canDelete,
}: {
  clientId: string;
  notes: NoteRow[];
  canDelete: boolean;
}) {
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Add an internal note</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const value = body.trim();
              if (!value) return;
              setError(null);
              startTransition(async () => {
                const result = await addNoteAction(clientId, value, pinned);
                if (result.ok) {
                  setBody('');
                  setPinned(false);
                } else setError(result.error);
              });
            }}
          >
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder="Only staff can see this. Context, preferences, anything worth remembering."
              aria-label="Note"
            />
            <div className="mt-3 flex items-center gap-3">
              <Button type="submit" size="sm" loading={pending} disabled={!body.trim()}>
                Save note
              </Button>
              <Checkbox
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
                label="Pin to the top"
              />
            </div>
            {error ? <p className="mt-2 text-xs text-critical">{error}</p> : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {notes.length === 0 ? (
            <EmptyState title="No notes yet" description="Notes are visible to staff only." />
          ) : (
            <ul className="divide-y divide-border">
              {notes.map((note) => (
                <li
                  key={note.id}
                  className={cn('flex gap-3 p-4', note.isPinned && 'bg-warning-subtle/40')}
                >
                  <Avatar name={note.author?.name ?? 'System'} src={note.author?.avatarUrl} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">
                      {note.author?.name ?? 'System'} · {timeAgo(note.createdAt)}
                    </p>
                    <p className="mt-1 text-sm whitespace-pre-wrap">{note.body}</p>
                  </div>
                  <div className="flex shrink-0 items-start gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={note.isPinned ? 'Unpin note' : 'Pin note'}
                      onClick={() =>
                        startTransition(async () => {
                          await toggleNotePinAction(clientId, note.id, !note.isPinned);
                        })
                      }
                    >
                      <PinIcon
                        className={cn('size-3.5', note.isPinned ? 'text-warning' : 'text-muted-foreground')}
                      />
                    </Button>
                    {canDelete ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete note"
                        onClick={() =>
                          startTransition(async () => {
                            await deleteNoteAction(clientId, note.id);
                          })
                        }
                      >
                        <Trash2Icon className="size-3.5 text-critical" />
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
