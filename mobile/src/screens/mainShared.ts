/**
 * Shared helpers for the main tab group (Home / History / Stats / Profile).
 *
 * These four screens all render the same three concepts — a category, a
 * session, and a moment in time — so the mapping from API shape to display
 * lives here once. Previously each screen re-derived them slightly
 * differently, which is why Home showed a session's *summed* score while
 * History showed the same number as if it were a 0–10 rating.
 *
 * No styling lives here: colours/spacing stay with the design tokens.
 */

import { Ionicons } from '@expo/vector-icons';

/** Loosely typed so react-i18next's overloaded TFunction assigns cleanly. */
export type TFn = (key: any, options?: any) => string;

/* ------------------------------------------------------------------ *
 * Categories
 * ------------------------------------------------------------------ */

/** The backend stores a free-text icon slug; map it onto the icon set. */
export const CATEGORY_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  code: 'code-slash-outline',
  calculator: 'calculator-outline',
  megaphone: 'megaphone-outline',
  users: 'people-outline',
  headphones: 'headset-outline',
  'trending-up': 'trending-up-outline',
  palette: 'color-palette-outline',
  briefcase: 'briefcase-outline',
  heart: 'heart-outline',
  book: 'book-outline',
  flask: 'flask-outline',
  hammer: 'hammer-outline',
};

export function categoryIcon(icon?: string | null): keyof typeof Ionicons.glyphMap {
  return (icon ? CATEGORY_ICON[icon] : undefined) ?? 'briefcase-outline';
}

export interface CategoryLike {
  id?: number;
  nameAr?: string | null;
  nameEn?: string | null;
  icon?: string | null;
  isPremium?: boolean;
}

/**
 * Pick the name for the active language, falling back to the other one rather
 * than to a dash — a category that has only an English name should still be
 * readable in Arabic mode.
 */
export function categoryName(
  category: CategoryLike | null | undefined,
  language: string,
  fallback = '—',
): string {
  if (!category) return fallback;
  const arabic = !language || language.startsWith('ar');
  const picked = arabic
    ? category.nameAr || category.nameEn
    : category.nameEn || category.nameAr;
  return picked || fallback;
}

/* ------------------------------------------------------------------ *
 * Sessions
 * ------------------------------------------------------------------ */

export type SessionKind = 'practice' | 'meeting';

export interface SessionLike {
  id: string | number;
  kind?: SessionKind | null;
  categoryId?: number;
  category?: CategoryLike | null;
  /** Sum of every answer's 0–10 score — NOT a rating on its own. */
  totalScore?: number | null;
  answerCount?: number | null;
  _count?: { answers?: number } | null;
  startedAt?: string | null;
  endedAt?: string | null;
}

export function answerCount(session: SessionLike | null | undefined): number {
  const n = Number(session?._count?.answers ?? session?.answerCount ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * A session's score on the same 0–10 scale as a single answer.
 *
 * `totalScore` is a running sum, so a 6-question session at 7/10 stores 42.
 * Rendering that raw — as the old Home and History screens did — makes every
 * long session look like a perfect score once it hits a ScoreBar.
 */
export function sessionAverage(session: SessionLike | null | undefined): number {
  const n = answerCount(session);
  if (!n) return 0;
  const avg = Number(session?.totalScore ?? 0) / n;
  if (!Number.isFinite(avg)) return 0;
  return Math.max(0, Math.min(10, avg));
}

export function sessionKind(session: SessionLike | null | undefined): SessionKind {
  return session?.kind === 'meeting' ? 'meeting' : 'practice';
}

/* ------------------------------------------------------------------ *
 * Human-readable time + counts
 *
 * Arabic marks singular / dual / plural differently and switches noun case
 * above ten, so i18next's `count` plural machinery (which depends on
 * Intl.PluralRules being present in the JS engine) is sidestepped in favour of
 * explicit keys. `{{n}}` is used instead of `{{count}}` so no lookup ever
 * resolves through the plural suffix path.
 * ------------------------------------------------------------------ */

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function relativeTime(
  value: string | number | Date | null | undefined,
  t: TFn,
): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);

  if (days <= 0) return t('time.today');
  if (days === 1) return t('time.yesterday');
  if (days < 7) {
    return days === 2 ? t('time.daysAgoTwo') : t('time.daysAgoFew', { n: days });
  }
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    if (weeks === 1) return t('time.lastWeek');
    if (weeks === 2) return t('time.weeksAgoTwo');
    return t('time.weeksAgoFew', { n: weeks });
  }
  if (days < 365) {
    const months = Math.max(1, Math.floor(days / 30));
    if (months === 1) return t('time.lastMonth');
    if (months === 2) return t('time.monthsAgoTwo');
    if (months <= 10) return t('time.monthsAgoFew', { n: months });
    return t('time.monthsAgoMany', { n: months });
  }
  const years = Math.floor(days / 365);
  if (years === 1) return t('time.lastYear');
  if (years === 2) return t('time.yearsAgoTwo');
  return t('time.yearsAgoFew', { n: years });
}

function countLabel(n: number, t: TFn, base: string): string {
  const safe = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  if (safe === 0) return t(`${base}Zero`);
  if (safe === 1) return t(`${base}One`);
  if (safe === 2) return t(`${base}Two`);
  if (safe <= 10) return t(`${base}Few`, { n: safe });
  return t(`${base}Many`, { n: safe });
}

export function questionCountLabel(n: number, t: TFn) {
  return countLabel(n, t, 'units.questions');
}

export function sessionCountLabel(n: number, t: TFn) {
  return countLabel(n, t, 'units.sessions');
}

export function minuteCountLabel(n: number, t: TFn) {
  return countLabel(n, t, 'units.minutes');
}

export function secondCountLabel(n: number, t: TFn) {
  return countLabel(n, t, 'units.seconds');
}

/**
 * A duration in words: "٧ دقائق و٢٢ ثانية" / "7 minutes and 22 seconds".
 *
 * Minutes are floored and the remainder is shown as seconds, so nothing is
 * rounded up — the same rule the server bills by. Under a minute it reads as
 * seconds alone; on an exact minute the seconds half is dropped rather than
 * printed as "and 0 seconds".
 */
export function durationLabel(seconds: number | null | undefined, t: TFn): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins === 0) return secondCountLabel(secs, t);
  if (secs === 0) return minuteCountLabel(mins, t);
  return t('units.durationBoth', {
    minutes: minuteCountLabel(mins, t),
    seconds: secondCountLabel(secs, t),
  });
}

/**
 * "March 2025" / "مارس ٢٠٢٥" for member-since lines.
 * Falls back to a plain ISO date if the JS engine ships without full ICU
 * (some Android Hermes builds), rather than throwing inside render.
 */
export function formatMonthYear(
  value: string | number | Date | null | undefined,
  language: string,
): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const locale = language?.startsWith('ar') ? 'ar-EG' : 'en-US';
  try {
    return date.toLocaleDateString(locale, { year: 'numeric', month: 'long' });
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * The balance headline: minutes once there is at least one, seconds below that.
 *
 * "بدون دقائق" for a user who still has 40 seconds is both wrong and the exact
 * moment they are most likely to complain, so the unit changes rather than the
 * number rounding to zero.
 */
export function balanceLabel(seconds: number | null | undefined, t: TFn): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return total < 60 ? secondCountLabel(total, t) : minuteCountLabel(Math.floor(total / 60), t);
}

/** "12 March 2025" / "١٢ مارس ٢٠٢٥" — for a subscription-allowance expiry. */
export function formatShortDate(
  value: string | number | Date | null | undefined,
  language: string,
): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return date.toLocaleDateString(language?.startsWith('ar') ? 'ar-EG' : 'en-GB', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** A session's date + question count, joined for a row subtitle. */
export function sessionMeta(session: SessionLike, t: TFn): string {
  const when = relativeTime(session.startedAt, t);
  const answers = questionCountLabel(answerCount(session), t);
  return when ? `${when} · ${answers}` : answers;
}
