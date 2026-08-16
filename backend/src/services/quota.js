/**
 * RETIRED: the daily question quota.
 *
 * The product no longer meters questions per day. It meters TIME: a ten-minute
 * free trial, purchased packs that never expire, and a subscription allowance
 * that does. The implementation moved to services/billing/minutes.js and
 * services/billing/meetings.js.
 *
 * This file survives one release as a compatibility shim, for one reason:
 * ROLLBACK. Migration 002 is additive and deliberately leaves
 * `users.daily_questions_used` and `users.last_reset_date` in place, so the
 * previous backend can be redeployed in ninety seconds if this one misbehaves.
 * Deleting the module — and the columns — before that window closes is how a
 * bad deploy becomes an outage. Migration 003 drops both, and this file goes
 * with them.
 *
 * What is still LIVE here:
 *   - `hasPremium` — re-exported from billing/minutes.js, which is now its home
 *     (the charging paths need it, and importing it back out of this module
 *     would make the two circular). Every existing importer keeps working.
 *   - `cairoToday` — routes/admin.js still uses it for Cairo-day reporting.
 *
 * What is DEAD here: consumeQuota, requireQuota, refundQuota, quotaSnapshot and
 * QUOTA_COST. They now translate "units" into seconds against the minute
 * balance so that nothing breaks mid-refactor, but no route should call them —
 * routes charge seconds explicitly, because a "unit" was never a real thing and
 * pretending otherwise is what let /meeting run unmetered for a whole release.
 */

import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/asyncHandler.js';
import {
  hasPremium, chargeFlat, refundFlat, balanceSnapshot, loadBalanceUser,
  CFG, toMinutes,
} from './billing/minutes.js';

export { hasPremium };

const APP_TZ = 'Africa/Cairo';

/**
 * Today's date in the app's timezone, as a UTC-midnight Date for a DATE column.
 *
 * Still used by the admin dashboard: the product's day boundary is Africa/Cairo
 * (server-local midnight is 2am Cairo), so "today's signups" must be counted
 * against the day the users actually experienced.
 */
export function cairoToday(now = new Date()) {
  // en-CA renders as YYYY-MM-DD, which is directly parseable.
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return new Date(`${ymd}T00:00:00.000Z`);
}

/**
 * DEPRECATED. Cost in quota units per feature, translated to seconds.
 *
 * Kept only so an unconverted caller still charges something sane instead of
 * charging nothing.
 */
export const QUOTA_COST = {
  answer: 1,
  meetingTurn: 1,
  meetingPrepare: 2,
  meetingFinish: 2,
};

const unitsToSeconds = (cost) => Math.max(0, Math.round(Number(cost) || 0)) * CFG.practiceAnswer();

/** DEPRECATED shim — charges `cost` units' worth of seconds. */
export async function consumeQuota(userId, cost = 1) {
  const seconds = unitsToSeconds(cost);
  try {
    const receipt = await chargeFlat({ userId, seconds, note: 'legacy_quota_shim' });
    const user = await loadBalanceUser(userId);
    const snap = await balanceSnapshot(user);
    return { allowed: true, used: 0, limit: null, remaining: snap.minutesRemaining, receipt };
  } catch (err) {
    if (err instanceof HttpError && err.status === 402) {
      return { allowed: false, used: 0, limit: null, remaining: 0 };
    }
    throw err;
  }
}

/** DEPRECATED shim. */
export async function refundQuota(userId, cost = 1) {
  const seconds = unitsToSeconds(cost);
  await refundFlat({ userId, subUsed: 0, perpUsed: seconds }, 'legacy_quota_shim');
}

/** DEPRECATED shim — throwing wrapper. */
export async function requireQuota(userId, cost = 1) {
  const q = await consumeQuota(userId, cost);
  if (!q.allowed) {
    throw new HttpError(
      402,
      'لم يتبقَّ رصيد من دقائق المقابلات / You have run out of interview minutes',
      { reason: 'insufficient_minutes', requiredSeconds: unitsToSeconds(cost) },
      'QUOTA_EXCEEDED',
    );
  }
  return q;
}

/**
 * Read-only snapshot, in BOTH vocabularies.
 *
 * Old clients (the cached /app bundle and the installed Play build) read
 * `used`/`limit`/`remaining`; new clients read the second half. `limit: null`
 * is what the old client renders as "unmetered", which is the least-wrong thing
 * an old client can be told about a balance it has no UI for.
 */
export async function quotaSnapshot(user) {
  const full = user?.balanceSeconds === undefined ? await loadBalanceUser(user.id) : user;
  const snap = await balanceSnapshot(full);
  return {
    plan: snap.plan,
    premiumUntil: snap.premiumUntil,
    used: 0,
    limit: null,
    remaining: null,
    ...snap,
    minutesRemaining: toMinutes(snap.availableSeconds),
  };
}

/** Escape hatch for a caller that only has an id. */
export async function quotaSnapshotFor(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(404, 'User not found');
  return quotaSnapshot(user);
}
