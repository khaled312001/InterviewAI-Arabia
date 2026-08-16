import { toDate } from '../../lib/format';

/**
 * The catalogue, transcribed from `PLANS` in
 * backend/src/services/payments/plans.js. The days are what matter here: a
 * grant whose duration matches a plan is labelled with that plan's code,
 * exactly as the server does when `planCode` is omitted.
 *
 * ONLY LIVE SUBSCRIPTION PLANS BELONG HERE. 'yearly' used to be listed and is
 * retired: it lives in LEGACY_PLANS with `retired: true`, is excluded from
 * planList() and purchasablePlan(), and migration 002 renamed the surviving
 * rows to 'yearly_legacy'. Offering it in these drawers stamped new manual
 * subscriptions with a code the product had withdrawn — the server now answers
 * UNKNOWN_PLAN_CODE for it. A 365-day grant is still possible; it is simply
 * recorded as a manual grant rather than as a plan nobody can buy.
 */
export const PLAN_PRESETS = [
  { code: 'monthly', days: 30, labelAr: 'شهري' },
  { code: 'quarterly', days: 90, labelAr: 'ربع سنوي' },
] as const;

export const MAX_GRANT_DAYS = 730;

/**
 * The client-side twin of computeExpiry() in services/payments/plans.js:
 * extend from the current expiry while it is still ahead, otherwise from now.
 * It exists so the drawer can show "ينتهي X ← سيصبح Y" before the operator
 * commits — the rule that stops a goodwill grant from destroying paid days is
 * invisible otherwise, and an operator who cannot see it will not trust it.
 * The server recomputes this; the preview never decides anything.
 */
export function previewExpiry(
  currentExpiresAt: string | Date | null | undefined,
  days: number,
  now: Date = new Date(),
): Date {
  const current = toDate(currentExpiresAt ?? null);
  const base = current && current.getTime() > now.getTime() ? current : now;
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

/** yyyy-mm-dd in the operator's own timezone — what <input type="date"> wants. */
export function toDateInput(value: string | Date | null | undefined): string {
  const d = toDate(value ?? null);
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A chosen day runs to its end, not to 00:00 of it. */
export function dateInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}T23:59:59`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toDateInput(d);
}

/** True while the mirror or a row still grants access. */
export function isCovering(expiresAt: string | Date | null | undefined): boolean {
  const d = toDate(expiresAt ?? null);
  return Boolean(d && d.getTime() > Date.now());
}
