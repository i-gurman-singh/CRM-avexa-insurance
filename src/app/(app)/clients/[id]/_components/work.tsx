'use client';

import { useState, useTransition } from 'react';
import { BotIcon, CheckIcon, ClockIcon, PlusIcon } from 'lucide-react';
import { formatDueDate, isOverdue } from '@/lib/dates';
import { cn } from '@/lib/utils';
import {
  completeFollowUpAction,
  createFollowUpAction,
  createTaskAction,
  setTaskStatusAction,
  snoozeFollowUpAction,
} from '@/server/actions/work';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  PriorityDot,
  Select,
} from '@/ui/components/primitives';

/**
 * Tasks and follow-ups for one client.
 *
 * Items created by automation are labelled as such — staff should be able to
 * tell instantly whether a task came from a colleague or from a rule reacting
 * to a message, because that changes how much they trust it.
 */

export interface ClientTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  dueAt: string | null;
  assignedName: string | null;
  createdBySystem: string;
}

export interface ClientFollowUp {
  id: string;
  reason: string;
  reasonKey: string;
  status: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  dueAt: string;
  assignedName: string | null;
  createdBySystem: string;
}

export function ClientWorkPanel({
  clientId,
  tasks,
  followUps,
  users,
}: {
  clientId: string;
  tasks: ClientTask[];
  followUps: ClientFollowUp[];
  users: Array<{ id: string; name: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [addingTask, setAddingTask] = useState(false);
  const [addingFollowUp, setAddingFollowUp] = useState(false);

  const openTasks = tasks.filter((t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS');
  const doneTasks = tasks.filter((t) => t.status === 'COMPLETED');
  const openFollowUps = followUps.filter((f) => f.status === 'SCHEDULED');
  const doneFollowUps = followUps.filter((f) => f.status !== 'SCHEDULED');

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {error ? (
        <p className="lg:col-span-2 rounded-md bg-critical-subtle px-3 py-2 text-xs text-critical" role="alert">
          {error}
        </p>
      ) : null}

      {/* Tasks ------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle>Tasks</CardTitle>
          <Button size="sm" variant={addingTask ? 'ghost' : 'outline'} onClick={() => setAddingTask(!addingTask)}>
            <PlusIcon className="size-3.5" />
            {addingTask ? 'Cancel' : 'Add task'}
          </Button>
        </CardHeader>

        {addingTask ? (
          <CardContent className="border-t border-border pt-4">
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                startTransition(async () => {
                  const result = await createTaskAction({
                    clientId,
                    title: data.get('title'),
                    description: data.get('description') || null,
                    priority: data.get('priority') || 'NORMAL',
                    dueAt: data.get('dueAt') || null,
                    assignedUserId: data.get('assignedUserId') || null,
                  });
                  if (result.ok) setAddingTask(false);
                  else setError(result.error);
                });
              }}
            >
              <Field label="Task" htmlFor="t-title" required className="sm:col-span-2">
                <Input id="t-title" name="title" required placeholder="Call the client about the renewal" />
              </Field>
              <Field label="Due" htmlFor="t-due">
                <Input id="t-due" name="dueAt" type="datetime-local" />
              </Field>
              <Field label="Priority" htmlFor="t-priority">
                <Select id="t-priority" name="priority" defaultValue="NORMAL">
                  <option value="LOW">Low</option>
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </Select>
              </Field>
              <Field label="Assign to" htmlFor="t-assignee" className="sm:col-span-2">
                <Select id="t-assignee" name="assignedUserId">
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="sm:col-span-2">
                <Button type="submit" size="sm" loading={pending}>
                  Create task
                </Button>
              </div>
            </form>
          </CardContent>
        ) : null}

        <CardContent className="p-0">
          {openTasks.length === 0 && doneTasks.length === 0 ? (
            <EmptyState title="No tasks" description="Nothing outstanding for this client." />
          ) : (
            <ul className="divide-y divide-border">
              {[...openTasks, ...doneTasks].map((task) => (
                <li key={task.id} className="flex items-start gap-3 px-4 py-3">
                  <button
                    type="button"
                    aria-label={task.status === 'COMPLETED' ? 'Reopen task' : 'Complete task'}
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await setTaskStatusAction(
                          task.id,
                          task.status === 'COMPLETED' ? 'OPEN' : 'COMPLETED',
                        );
                        if (!result.ok) setError(result.error);
                      })
                    }
                    className={cn(
                      'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                      task.status === 'COMPLETED'
                        ? 'border-success bg-success text-success-foreground'
                        : 'border-border-strong hover:border-primary',
                    )}
                  >
                    {task.status === 'COMPLETED' ? <CheckIcon className="size-3" /> : null}
                  </button>

                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'text-sm',
                        task.status === 'COMPLETED' && 'text-muted-foreground line-through',
                      )}
                    >
                      {task.title}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <PriorityDot priority={task.priority} />
                      <span className={cn(isOverdue(task.dueAt) && task.status !== 'COMPLETED' && 'text-critical')}>
                        {formatDueDate(task.dueAt)}
                      </span>
                      {task.assignedName ? <span>· {task.assignedName}</span> : null}
                      {task.createdBySystem !== 'manual' ? (
                        <Badge tone="info" className="gap-1 px-1.5 py-0 text-[10px]">
                          <BotIcon className="size-2.5" aria-hidden />
                          automated
                        </Badge>
                      ) : null}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Follow-ups ------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Follow-ups</CardTitle>
          <Button
            size="sm"
            variant={addingFollowUp ? 'ghost' : 'outline'}
            onClick={() => setAddingFollowUp(!addingFollowUp)}
          >
            <PlusIcon className="size-3.5" />
            {addingFollowUp ? 'Cancel' : 'Schedule'}
          </Button>
        </CardHeader>

        {addingFollowUp ? (
          <CardContent className="border-t border-border pt-4">
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                startTransition(async () => {
                  const result = await createFollowUpAction(clientId, {
                    reasonKey: data.get('reasonKey'),
                    reason: data.get('reason') || null,
                    dueAt: data.get('dueAt'),
                    priority: data.get('priority') || 'NORMAL',
                    assignedUserId: data.get('assignedUserId') || null,
                    notes: data.get('notes') || null,
                  });
                  if (result.ok) setAddingFollowUp(false);
                  else setError(result.error);
                });
              }}
            >
              <Field label="Reason" htmlFor="f-reason">
                <Select id="f-reason" name="reasonKey" defaultValue="manual">
                  <option value="manual">Manual follow-up</option>
                  <option value="quote_no_response">Quote sent, no response</option>
                  <option value="price_objection">Price objection</option>
                  <option value="thinking_about_it">Asked to think about it</option>
                  <option value="missing_information">Missing information</option>
                  <option value="missing_documents">Missing documents</option>
                  <option value="call_later">Asked to be called later</option>
                  <option value="renewal_approaching">Renewal approaching</option>
                </Select>
              </Field>
              <Field label="Due" htmlFor="f-due" required>
                <Input id="f-due" name="dueAt" type="datetime-local" required />
              </Field>
              <Field label="Priority" htmlFor="f-priority">
                <Select id="f-priority" name="priority" defaultValue="NORMAL">
                  <option value="LOW">Low</option>
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </Select>
              </Field>
              <Field label="Assign to" htmlFor="f-assignee">
                <Select id="f-assignee" name="assignedUserId">
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Notes" htmlFor="f-notes" className="sm:col-span-2">
                <Input id="f-notes" name="notes" placeholder="Optional" />
              </Field>
              <div className="sm:col-span-2">
                <Button type="submit" size="sm" loading={pending}>
                  Schedule follow-up
                </Button>
              </div>
            </form>
          </CardContent>
        ) : null}

        <CardContent className="p-0">
          {openFollowUps.length === 0 && doneFollowUps.length === 0 ? (
            <EmptyState title="No follow-ups" description="Nothing scheduled for this client." />
          ) : (
            <ul className="divide-y divide-border">
              {[...openFollowUps, ...doneFollowUps].map((followUp) => (
                <li key={followUp.id} className="flex items-start gap-3 px-4 py-3">
                  <ClockIcon
                    className={cn(
                      'mt-0.5 size-4 shrink-0',
                      followUp.status !== 'SCHEDULED'
                        ? 'text-muted-foreground'
                        : isOverdue(followUp.dueAt)
                          ? 'text-critical'
                          : 'text-warning',
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm', followUp.status !== 'SCHEDULED' && 'text-muted-foreground')}>
                      {followUp.reason}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <PriorityDot priority={followUp.priority} />
                      <span className={cn(isOverdue(followUp.dueAt) && followUp.status === 'SCHEDULED' && 'text-critical')}>
                        {formatDueDate(followUp.dueAt)}
                      </span>
                      {followUp.assignedName ? <span>· {followUp.assignedName}</span> : null}
                      {followUp.createdBySystem !== 'manual' ? (
                        <Badge tone="info" className="gap-1 px-1.5 py-0 text-[10px]">
                          <BotIcon className="size-2.5" aria-hidden />
                          automated
                        </Badge>
                      ) : null}
                      {followUp.status !== 'SCHEDULED' ? <Badge tone="neutral">{followUp.status.toLowerCase()}</Badge> : null}
                    </p>
                  </div>

                  {followUp.status === 'SCHEDULED' ? (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={pending}
                        onClick={() =>
                          startTransition(async () => {
                            const until = new Date(Date.now() + 2 * 86_400_000).toISOString();
                            const result = await snoozeFollowUpAction(followUp.id, until);
                            if (!result.ok) setError(result.error);
                          })
                        }
                      >
                        +2d
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        loading={pending}
                        onClick={() =>
                          startTransition(async () => {
                            const result = await completeFollowUpAction(followUp.id);
                            if (!result.ok) setError(result.error);
                          })
                        }
                      >
                        Done
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
