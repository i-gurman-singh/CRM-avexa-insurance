import {
  BotIcon,
  CheckCircle2Icon,
  FileTextIcon,
  MessageSquareIcon,
  PencilIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TrendingUpIcon,
  UserPlusIcon,
  WorkflowIcon,
} from 'lucide-react';
import { formatDateTime, timeAgo } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { Card, CardContent, EmptyState } from '@/ui/components/primitives';

/**
 * Client activity timeline.
 *
 * The whole history of a file in one column, so a broker picking up someone
 * else's client can catch up in fifteen seconds. Icon and colour encode who
 * acted: the client, a member of staff, AI, or an automated workflow.
 */

export interface TimelineEvent {
  id: string;
  type: string;
  title: string;
  body: string | null;
  createdAt: Date;
  actorType: string;
  actorUser: { name: string } | null;
}

const ICONS: Array<{ match: RegExp; Icon: typeof MessageSquareIcon }> = [
  { match: /^message\./, Icon: MessageSquareIcon },
  { match: /^ai\./, Icon: BotIcon },
  { match: /^document\.|^checklist\./, Icon: FileTextIcon },
  { match: /^quote\./, Icon: TrendingUpIcon },
  { match: /^policy\./, Icon: ShieldCheckIcon },
  { match: /^stage\./, Icon: WorkflowIcon },
  { match: /^client\.created/, Icon: UserPlusIcon },
  { match: /^client\./, Icon: PencilIcon },
  { match: /^task\.|^followup\./, Icon: CheckCircle2Icon },
  { match: /^note\./, Icon: PencilIcon },
];

function iconFor(type: string) {
  return ICONS.find((i) => i.match.test(type))?.Icon ?? SparklesIcon;
}

const ACTOR_STYLES: Record<string, string> = {
  client: 'bg-primary-subtle text-primary',
  ai: 'bg-warning-subtle text-warning',
  workflow: 'bg-info-subtle text-info',
  user: 'bg-surface-muted text-muted-foreground',
  system: 'bg-surface-muted text-muted-foreground',
};

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <Card>
        <EmptyState title="Nothing has happened yet" description="Activity will appear here as the file progresses." />
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <ol className="relative space-y-4 border-l border-border pl-6">
          {events.map((event) => {
            const Icon = iconFor(event.type);
            return (
              <li key={event.id} className="relative">
                <span
                  className={cn(
                    'absolute -left-[2.05rem] flex size-6 items-center justify-center rounded-full ring-4 ring-surface',
                    ACTOR_STYLES[event.actorType] ?? ACTOR_STYLES.system,
                  )}
                  aria-hidden
                >
                  <Icon className="size-3" />
                </span>

                <div className="min-w-0">
                  <p className="text-sm font-medium">{event.title}</p>
                  {event.body ? (
                    <p className="mt-0.5 text-xs whitespace-pre-wrap text-muted-foreground">{event.body}</p>
                  ) : null}
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    <time dateTime={event.createdAt.toISOString()} title={formatDateTime(event.createdAt)}>
                      {timeAgo(event.createdAt)}
                    </time>
                    {' · '}
                    {event.actorUser
                      ? event.actorUser.name
                      : event.actorType === 'client'
                        ? 'Client'
                        : event.actorType === 'ai'
                          ? 'AI'
                          : event.actorType === 'workflow'
                            ? 'Automation'
                            : 'System'}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
