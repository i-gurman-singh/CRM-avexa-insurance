import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind-aware className combiner used by every UI component. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Normalise a phone number to E.164-ish form. Defaults to +1 (Canada/US)
 * because the brokerage is Ontario-based; change DEFAULT_COUNTRY_CODE or make
 * it a Setting if you expand.
 */
const DEFAULT_COUNTRY_CODE = '1';

export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) {
    digits = `+${digits.slice(1).replace(/\D/g, '')}`;
  } else {
    digits = digits.replace(/\D/g, '');
    if (digits.length === 10) digits = `+${DEFAULT_COUNTRY_CODE}${digits}`;
    else if (digits.length === 11 && digits.startsWith(DEFAULT_COUNTRY_CODE)) digits = `+${digits}`;
    else digits = `+${digits}`;
  }
  if (digits.length < 8 || digits.length > 17) return null;
  return digits;
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const m = phone.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (m) return `(${m[1]}) ${m[2]}-${m[3]}`;
  return phone;
}

export function formatCurrency(
  value: number | string | null | undefined,
  currency = 'CAD',
  opts: { compact?: boolean } = {},
): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';

  // Compact notation only earns its keep on large numbers. Below $10k it
  // produces things like "$272.2", which reads worse than the real figure.
  const useCompact = opts.compact === true && Math.abs(n) >= 10_000;

  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    notation: useCompact ? 'compact' : 'standard',
    // Premiums are quoted to the cent, so standard formatting keeps them.
    maximumFractionDigits: useCompact ? 1 : 2,
  }).format(n);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-CA').format(value);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

/** Age in whole years from a date of birth. */
export function calculateAge(dob: Date | string | null | undefined, at: Date = new Date()): number | null {
  if (!dob) return null;
  const d = typeof dob === 'string' ? new Date(dob) : dob;
  if (Number.isNaN(d.getTime())) return null;
  let age = at.getFullYear() - d.getFullYear();
  const m = at.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < d.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/** Whole years between a date and now — used for "years licensed" from G date. */
export function yearsSince(date: Date | string | null | undefined, at: Date = new Date()): number | null {
  return calculateAge(date, at);
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function truncate(text: string | null | undefined, max = 120): string {
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Start/end of day in the server's timezone. */
export function startOfDay(d: Date = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date = new Date()): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export function addHours(d: Date, hours: number): Date {
  return new Date(d.getTime() + hours * 3600_000);
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Decimal columns come back from Prisma as objects; normalise for the UI. */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === 'object' && 'toString' in (value as object)) {
    const n = Number(String(value));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Deep-ish plain object clone that survives the server/client boundary. */
export function serialize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === 'bigint') return Number(v);
      if (v && typeof v === 'object' && v.constructor?.name === 'Decimal') return Number(v);
      return v;
    }),
  );
}

export function uniqueBy<T, K>(items: T[], key: (item: T) => K): T[] {
  const seen = new Set<K>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export function groupBy<T, K extends string | number>(items: T[], key: (item: T) => K): Record<K, T[]> {
  return items.reduce(
    (acc, item) => {
      const k = key(item);
      (acc[k] ||= []).push(item);
      return acc;
    },
    {} as Record<K, T[]>,
  );
}

export function safeDivide(numerator: number, denominator: number, fallback = 0): number {
  return denominator === 0 ? fallback : numerator / denominator;
}

export function percentage(part: number, whole: number): number {
  return whole === 0 ? 0 : (part / whole) * 100;
}
