import { BotIcon, CheckCircle2Icon, PencilIcon, UploadIcon } from 'lucide-react';
import type { FieldSource } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * Shows where a field's value came from.
 *
 * This tiny component is doing important work: it is the difference between
 * staff trusting the CRM and staff double-checking everything by hand. An
 * amber "AI" chip means "a model read this off a photo and nobody has checked
 * it"; a green tick means a person confirmed it.
 */

const CONFIG: Record<
  FieldSource,
  { label: string; title: string; className: string; Icon: typeof BotIcon }
> = {
  AI_EXTRACTED: {
    label: 'AI',
    title: 'Read by AI from a document — not yet verified by staff',
    className: 'bg-warning-subtle text-warning',
    Icon: BotIcon,
  },
  STAFF_VERIFIED: {
    label: 'Verified',
    title: 'Checked and confirmed by a member of staff',
    className: 'bg-success-subtle text-success',
    Icon: CheckCircle2Icon,
  },
  MANUAL: {
    label: 'Entered',
    title: 'Typed in by a member of staff',
    className: 'bg-surface-muted text-muted-foreground',
    Icon: PencilIcon,
  },
  IMPORTED: {
    label: 'Imported',
    title: 'Migrated in from another system',
    className: 'bg-surface-muted text-muted-foreground',
    Icon: UploadIcon,
  },
  SYSTEM: {
    label: 'Derived',
    title: 'Calculated by the CRM',
    className: 'bg-surface-muted text-muted-foreground',
    Icon: CheckCircle2Icon,
  },
};

export function ProvenanceBadge({
  source,
  confidence,
  compact = true,
  className,
}: {
  source: FieldSource | null | undefined;
  confidence?: number | null;
  compact?: boolean;
  className?: string;
}) {
  // No provenance recorded means nobody has touched it — nothing to show.
  if (!source) return null;

  const config = CONFIG[source];
  const showConfidence = source === 'AI_EXTRACTED' && typeof confidence === 'number';
  const title = showConfidence
    ? `${config.title} (${Math.round(confidence * 100)}% confident)`
    : config.title;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
        config.className,
        className,
      )}
      title={title}
    >
      <config.Icon className="size-2.5" aria-hidden />
      {compact ? null : config.label}
      {showConfidence ? `${Math.round(confidence * 100)}%` : null}
      {compact && !showConfidence ? config.label : null}
    </span>
  );
}

/** Summary chip for a whole record: "3 fields need checking". */
export function UnverifiedCount({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-warning-subtle px-2 py-0.5 text-xs font-medium text-warning"
      title="Values extracted by AI that no one has confirmed yet"
    >
      <BotIcon className="size-3" aria-hidden />
      {count} to verify
    </span>
  );
}
