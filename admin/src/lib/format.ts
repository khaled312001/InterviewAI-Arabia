export const LOCALE = 'ar-EG';
/** The product's day boundary (backend/src/services/quota.js). */
export const TIMEZONE = 'Africa/Cairo';

export type NumFormat = 'int' | 'decimal' | 'compact' | 'percent' | 'bytes' | 'ms';

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

/** `digits` applies to 'decimal' only — scores and averages that would lie if
 *  rounded to a whole number. */
export function formatNumber(value: number, format: NumFormat = 'int', digits = 1): string {
  switch (format) {
    case 'decimal':
      return nf({ minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value);
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

export interface CountForms {
  /** Used alone, without a numeral: "سؤال واحد". */
  one: string;
  /** Used alone, without a numeral: "سؤالان". */
  two: string;
  /** 3–10, with the numeral: "٥ أسئلة". */
  few: string;
  /** 0 and 11+, with the numeral: "١١ سؤالًا". */
  many: string;
}

/**
 * Arabic number agreement, for the counts that appear inside a sentence —
 * confirmation titles and bulk-result toasts. Arabic does not pluralise like
 * English: 1 and 2 have their own forms and take no numeral, 3–10 take the
 * plural, and 11+ take the singular accusative. `${n} سؤالًا` is wrong for every
 * n between 3 and 10, which is most of them.
 *
 * Grid cells and stat tiles keep using <Num>; this is for prose.
 */
export function countAr(n: number, forms: CountForms): string {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  const noun = n >= 3 && n <= 10 ? forms.few : forms.many;
  return `${formatNumber(n)} ${noun}`;
}

/** The two nouns this admin counts in prose often enough to name once. */
export const QUESTION_FORMS: CountForms = {
  one: 'سؤالًا واحدًا',
  two: 'سؤالين',
  few: 'أسئلة',
  many: 'سؤالًا',
};

export const MINUTE_FORMS: CountForms = {
  one: 'دقيقة واحدة',
  two: 'دقيقتان',
  few: 'دقائق',
  many: 'دقيقة',
};

export const SECOND_FORMS: CountForms = {
  one: 'ثانية واحدة',
  two: 'ثانيتان',
  few: 'ثوانٍ',
  many: 'ثانية',
};

/* ------------------------------- durations -------------------------------
 * The minute balance is stored, charged and returned in whole SECONDS
 * (backend/src/services/billing/minutes.js). Minutes exist only for reading,
 * so every conversion happens here and none of it happens in a component.
 */

/**
 * Seconds → whole minutes, ALWAYS ROUNDED DOWN.
 *
 * Matches `toMinutes()` in services/billing/minutes.js, and the direction
 * matters: understating a balance by under a minute errs in the customer's
 * favour, while rounding 3m50s up to "4 minutes" produces "it said four and cut
 * me off at three". Support reads the same number the app shows the user.
 */
export function secondsToMinutes(seconds: number): number {
  return Math.floor(Math.max(0, seconds) / 60);
}

/**
 * Seconds → `m:ss` (or `h:mm:ss`). The ledger's unit.
 *
 * The statement is where a charge gets reconciled against an interview, so it
 * shows the seconds the balance was actually moved by — a ledger rounded to
 * minutes cannot be added up and checked against the balance it produced.
 */
export function formatClock(totalSeconds: number): string {
  const total = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => nf({ minimumIntegerDigits: 2, useGrouping: false }).format(n);
  const plain = (n: number) => nf({ useGrouping: false }).format(n);
  return h > 0 ? `${plain(h)}:${pad(m)}:${pad(s)}` : `${plain(m)}:${pad(s)}`;
}

/**
 * Seconds → Arabic prose: «٧ دقائق و٢٢ ثانية».
 *
 * For sentences and receipts, where `7:22` reads as a time of day. Seconds are
 * dropped once the figure passes an hour — nobody reconciles a two-hour balance
 * to the second, and the extra component just makes the sentence unreadable.
 */
export function formatDurationAr(totalSeconds: number): string {
  const total = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  if (minutes === 0) return countAr(seconds, SECOND_FORMS);
  if (seconds === 0 || minutes >= 60) return countAr(minutes, MINUTE_FORMS);
  return `${countAr(minutes, MINUTE_FORMS)} و${countAr(seconds, SECOND_FORMS)}`;
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

/* ----------------------------- calendar days -----------------------------
 * Analytics windows are Cairo calendar days, matching the backend's day
 * boundary. A plain 'YYYY-MM-DD' is the only form passed over the wire — it
 * carries no time and therefore cannot be shifted by the browser's zone.
 */

const YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date in the product's timezone, as 'YYYY-MM-DD'. */
export function todayYmd(at: Date = new Date()): string {
  return YMD.format(at);
}

export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** First day of the Cairo month that `ymd` falls in. */
export function startOfMonthYmd(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

export function daysBetweenYmd(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00.000Z`);
  const b = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((b - a) / 86_400_000);
}

/** A bare 'YYYY-MM-DD' rendered in Arabic. Parsed as UTC and formatted as UTC
 *  so the calendar day never shifts by a timezone it does not carry. */
export function formatYmd(
  ymd: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', ...options }).format(d);
}

/** Compact axis tick for a daily series — day + short month. */
export function formatYmdShort(ymd: string): string {
  return formatYmd(ymd, { day: 'numeric', month: 'short' });
}

/** Truncates a Latin identifier in the middle so both ends stay readable. */
export function truncateMiddle(value: string, max = 18): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}
