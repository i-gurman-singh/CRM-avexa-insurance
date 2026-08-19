'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { BotIcon, CheckIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { formatDueDate, isOverdue } from '@/lib/dates';
import { cn } from '@/lib/utils';
import {
  assignTaskAction,
  createTaskAction,
  deleteTaskAction,
  setTaskStatusAction,
} from '@/server/actions/work';
import {
  Badge,
  Button,
  Card,
  CardContent,
  ColorBadge,
  Field,
  Input,
  PriorityDot,
  Select,
} from '@/ui/components/primitives';

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  dueAt: string | null;
  clientId: string | null;
  clientName: string | null;
  stageName: string | null;
  stageColor: string | null;
  assignedUserId: string | null;
  assignedName: string | null;
  typeName: string | null;
  createdBySystem: string;
}

export function TaskList({
  tasks,
  users,
}: {
  tasks: TaskRow[];
  users: Array<{ id: string; name: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      {error ? (
        <p className="border-b border-border bg-critical-subtle px-4 py-2 text-xs text-critical" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-border">
        {tasks.map((task) => {
          const done = task.status === 'COMPLETED';
          return (
            <li key={task.id} className="flex items-start gap-3 px-4 py-3">
              <button
                type="button"
                aria-label={done ? 'Reopen task' : 'Mark complete'}
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await setTaskStatusAction(task.id, done ? 'OPEN' : 'COMPLETED');
                    if (!result.ok) setError(result.error);
                  })
                }
                className={cn(
                  'mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded border transition-colors',
                  done
                    ? 'border-success bg-success text-success-foreground'
                    : 'border-border-strong hover:border-primary',
                )}
              >
                {done ? <CheckIcon className="size-3" /> : null}
              </button>

              <div className="min-w-0 flex-1">
                <p className={cn('text-sm font-medium', done && 'text-muted-foreground line-through')}>
                  {task.title}
                </p>
                {task.description ? (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
                ) : null}

                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <PriorityDot priority={task.priority} />
                  <span className={cn(!done && isOverdue(task.dueAt) && 'font-medium text-critical')}>
                    {formatDueDate(task.dueAt)}
                  </span>

                  {task.clientId ? (
                    <Link href={`/clients/${task.clientId}`} className="hover:underline">
                      {task.clientName}
                    </Link>
                  ) : null}

                  {task.stageName && task.stageColor ? (
                    <ColorBadge color={task.stageColor}>{task.stageName}</ColorBadge>
                  ) : null}

                  {task.typeName ? <Badge tone="neutral">{task.typeName}</Badge> : null}

                  {task.createdBySystem !== 'manual' ? (
                    <Badge tone="info" className="gap-1 px-1.5 py-0 text-[10px]" title={task.createdBySystem}>
                      <BotIcon className="size-2.5" aria-hidden />
                      automated
                    </Badge>
                  ) : null}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Select
                  value={task.assignedUserId ?? ''}
                  aria-label={`Assign ${task.title}`}
                  className="h-8 w-auto min-w-32 text-xs"
                  disabled={pending}
                  onChange={(e) =>
                    startTransition(async () => {
                      const result = await assignTaskAction(task.id, e.target.value || null);
                      if (!result.ok) setError(result.error);
                    })
                  }
                >
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>

                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete task"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await deleteTaskAction(task.id);
                      if (!result.ok) setError(result.error);
                    })
                  }
                >
                  <Trash2Icon className="size-3.5 text-critical" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function NewTaskButton({
  users,
  taskTypes,
}: {
  users: Array<{ id: string; name: string }>;
  taskTypes: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <PlusIcon className="size-4" />
        New task
      </Button>
    );
  }

  return (
    <Card className="absolute right-6 z-20 mt-2 w-80 p-4 shadow-[var(--shadow-overlay)]">
      <CardContent className="p-0">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            startTransition(async () => {
              const result = await createTaskAction({
                title: data.get('title'),
                taskTypeId: data.get('taskTypeId') || null,
                priority: data.get('priority') || 'NORMAL',
                dueAt: data.get('dueAt') || null,
                assignedUserId: data.get('assignedUserId') || null,
              });
              if (result.ok) setOpen(false);
              else setError(result.error);
            });
          }}
        >
          <Field label="Task" htmlFor="nt-title" required>
            <Input id="nt-title" name="title" required autoFocus placeholder="What needs doing?" />
          </Field>
          <Field label="Type" htmlFor="nt-type">
            <Select id="nt-type" name="taskTypeId">
              <option value="">None</option>
              {taskTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due" htmlFor="nt-due">
            <Input id="nt-due" name="dueAt" type="datetime-local" />
          </Field>
          <Field label="Priority" htmlFor="nt-priority">
            <Select id="nt-priority" name="priority" defaultValue="NORMAL">
              <option value="LOW">Low</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </Select>
          </Field>
          <Field label="Assign to" htmlFor="nt-assignee">
            <Select id="nt-assignee" name="assignedUserId">
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>

          {error ? <p className="text-xs text-critical">{error}</p> : null}

          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={pending}>
              Create
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
