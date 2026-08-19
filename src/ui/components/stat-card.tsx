import Link from 'next/link';
import { ArrowRightIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Dashboard stat tile.
 *
 * Tone is semantic, not decorative: `critical` means someone should act now,
 * `warning` means today, `neutral` means nothing is wrong. Zero values are
 * deliberately muted so a screen full of noughts reads as "nothing to do"
 * rather than as a wall of colour.
 */

export type StatTone = 'neutral' | 'info' | 'success' | 'warning' | 'critical';

const toneStyles: Record<StatTone, { value: string; accent: string }> = {
  neutral: { value: 'text-foreground', accent: 'bg-border' },
  info: { value: 'text-info', accent: 'bg-info' },
  success: { value: 'text-success', accent: 'bg-success' },
  warning: { value: 'text-warning', accent: 'bg-warning' },
  critical: { value: 'text-critical', accent: 'bg-critical' },
};

export function StatCard({
  label,
  value,
  href,
  tone = 'neutral',
  hint,
  className,
}: {
  label: string;
  value: number | string;
  href?: string;
  tone?: StatTone;
  hint?: string;
  className?: string;
}) {
  const isZero = value === 0;
  const effectiveTone: StatTone = isZero ? 'neutral' : tone;
  const styles = toneStyles[effectiveTone];

  const body = (
    <>
      <span
        className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-lg', styles.accent)}
        aria-hidden
      />
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn('mt-1.5 text-2xl font-semibold tabular-nums', isZero ? 'text-muted-foreground' : styles.value)}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p> : null}
      {href ? (
        <ArrowRightIcon
          className="absolute right-3 bottom-3 size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
      ) : null}
    </>
  );

  const classes = cn(
    'group relative overflow-hidden rounded-lg border border-border bg-surface p-3.5 shadow-[var(--shadow-card)]',
    href && 'transition-shadow hover:shadow-[var(--shadow-raised)]',
    className,
  );

  if (!href) return <div className={classes}>{body}</div>;

  return (
    <Link href={href} className={classes}>
      {body}
    </Link>
  );
}
