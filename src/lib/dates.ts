import { format, formatDistanceToNowStrict, isToday, isTomorrow, isYesterday } from 'date-fns';

/**
 * All user-facing date formatting lives here so the display style can be
 * changed once (or made locale-aware later) without touching components.
 */

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  return format(date, 'MMM d, yyyy');
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  return format(date, "MMM d, yyyy 'at' h:mm a");
}

export function formatTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  return format(date, 'h:mm a');
}

/** "2h ago", "3d ago" — compact enough for list rows. */
export function timeAgo(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  return `${formatDistanceToNowStrict(date)} ago`;
}

/** "Today at 3:14 PM" / "Tomorrow" / "Mar 4" — for due dates. */
export function formatDueDate(d: Date | string | null | undefined): string {
  if (!d) return 'No due date';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return 'No due date';
  if (isToday(date)) return `Today at ${format(date, 'h:mm a')}`;
  if (isTomorrow(date)) return `Tomorrow at ${format(date, 'h:mm a')}`;
  if (isYesterday(date)) return `Yesterday at ${format(date, 'h:mm a')}`;
  return format(date, "MMM d 'at' h:mm a");
}

/** Chat bubble separators. */
export function formatChatDay(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'EEEE, MMMM d, yyyy');
}

export function isOverdue(d: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!d) return false;
  const date = typeof d === 'string' ? new Date(d) : d;
  return !Number.isNaN(date.getTime()) && date.getTime() < now.getTime();
}

export function toIsoDateInput(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '';
  return format(date, 'yyyy-MM-dd');
}

export function toIsoDateTimeInput(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '';
  return format(date, "yyyy-MM-dd'T'HH:mm");
}
