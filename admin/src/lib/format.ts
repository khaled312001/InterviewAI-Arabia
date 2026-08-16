export const LOCALE = 'ar-EG';
/** The product's day boundary (backend/src/services/quota.js). */
export const TIMEZONE = 'Africa/Cairo';

export type NumFormat = 'int' | 'compact' | 'percent' | 'bytes' | 'ms';

const cache = new Map<string, Intl.NumberFormat>();
function nf(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, options);
    cache.set(key, f);
  }
  return f;
}

export function formatNumber(value: number, format: NumFormat = 'int'): string {
  switch (format) {
    case 'compact':
      return nf({ notation: 'compact', maximumFractionDigits: 1 }).format(value);
    case 'percent':
      return nf({ style: 'percent', maximumFractionDigits: 1 }).format(value);
    case 'bytes': {
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let v = value;
      let i = 0;
      while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i += 1;
      }
      return `${nf({ maximumFractionDigits: 1 }).format(v)} ${units[i]}`;
    }
    case 'ms':
      return value >= 1000
        ? `${nf({ maximumFractionDigits: 2 }).format(value / 1000)} ث`
        : `${nf({ maximumFractionDigits: 0 }).format(value)} م.ث`;
    case 'int':
    default:
      return nf({ maximumFractionDigits: 0 }).format(value);
  }
}

export function formatMoney(major: number, currency: string, precision: number): string {
  return nf({
    style: 'currency',
    currency,
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(major);
}

/** null/invalid must be detectable — `new Date(null)` is 1970, never a date. */
export function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatAbsolute(
  date: Date,
  { timeZone = TIMEZONE, showSeconds = false }: { timeZone?: string; showSeconds?: boolean } = {},
): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    dateStyle: 'medium',
    timeStyle: showSeconds ? 'medium' : 'short',
  }).format(date);
}

const RTF = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
const DIVISIONS: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
];

export function formatRelative(date: Date, now: Date = new Date()): string {
  let duration = (date.getTime() - now.getTime()) / 1000;
  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return RTF.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return formatAbsolute(date);
}

/** Truncates a Latin identifier in the middle so both ends stay readable. */
export function truncateMiddle(value: string, max = 18): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}
