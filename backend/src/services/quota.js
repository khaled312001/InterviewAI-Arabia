/**
 * Daily quota + premium entitlement.
 *
 * Both were previously re-implemented per route with subtly different rules,
 * and both were exploitable:
 *
 * 1. RACE. `sessions.js` read the counter, compared it, called the AI, and
 *    only then incremented. Ten concurrent requests all read "4 used" and all
 *    passed the check, so a free user could spend ten AI calls against a
 *    five-call limit. The consume below is a single atomic conditional UPDATE.
 *
 * 2. UNMETERED FEATURES. The whole /api/meeting surface — the most expensive
 *    calls in the product — consumed no quota at all.
 *
 * 3. TIMEZONE. The reset boundary used server-local midnight (UTC in prod),
 *    which is 2am Cairo. Users lost their allowance mid-evening. The day is
 *    now computed in Africa/Cairo.
 */

import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { freeDailyLimit } from './appSettings.js';
import { HttpError } from '../utils/asyncHandler.js';

const APP_TZ = 'Africa/Cairo';

/** Today's date in the app's timezone, as a UTC-midnight Date for a DATE column. */
export function cairoToday(now = new Date()) {
  // en-CA renders as YYYY-MM-DD, which is directly parseable.
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return new Date(`${ymd}T00:00:00.000Z`);
}

/**
 * True when the user currently holds premium access.
 *
 * Reads the denormalised `premiumUntil` rather than joining subscriptions, so
 * this is cheap enough to call on every request. `plan` alone is not trusted:
 * if the expiry sweep fails to run (it did not run at all on the serverless
 * deploy), `plan` stays 'premium' forever and one payment buys lifetime access.
 */
export function hasPremium(user, now = new Date()) {
  if (!user) return false;
  return user.plan === 'premium' && !!user.premiumUntil && user.premiumUntil > now;
}

/**
 * Atomically consume `cost` units of today's allowance.
 *
 * The reset and the decrement happen in ONE statement, so there is no window
 * between checking and spending. Premium users match the first branch of the
 * WHERE and are never blocked.
 *
 * @returns {Promise<{allowed: boolean, used: number, limit: number|null, remaining: number|null}>}
 */
export async function consumeQuota(userId, cost = 1) {
  const today = cairoToday();
  const limit = freeDailyLimit();
  const now = new Date();

  // One UPDATE that simultaneously: rolls the counter over if the stored reset
  // date is stale, and increments — but only if the resulting value stays
  // within the allowance (or the user is premium).
  const updated = await prisma.$executeRaw`
    UPDATE users
       SET daily_questions_used =
             CASE WHEN last_reset_date IS NULL OR last_reset_date < ${today}
                  THEN ${cost}
                  ELSE daily_questions_used + ${cost} END,
           last_reset_date = ${today}
     WHERE id = ${userId}
       AND is_disabled = 0
       AND (
             (plan = 'premium' AND premium_until IS NOT NULL AND premium_until > ${now})
             OR (CASE WHEN last_reset_date IS NULL OR last_reset_date < ${today}
                      THEN 0 ELSE daily_questions_used END) + ${cost} <= ${limit}
           )
  `;

  if (updated === 0) {
    // Either over the limit, disabled, or gone. Read back to say which.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, premiumUntil: true, dailyQuestionsUsed: true, lastResetDate: true, isDisabled: true },
    });
    if (!user) throw new HttpError(404, 'User not found');
    if (user.isDisabled) throw new HttpError(403, 'This account is suspended', undefined, 'ACCOUNT_DISABLED');

    const staleReset = !user.lastResetDate || user.lastResetDate < today;
    const used = staleReset ? 0 : user.dailyQuestionsUsed;
    return { allowed: false, used, limit, remaining: Math.max(0, limit - used) };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, premiumUntil: true, dailyQuestionsUsed: true },
  });
  const premium = hasPremium(user);

  return {
    allowed: true,
    used: user.dailyQuestionsUsed,
    limit: premium ? null : limit,
    remaining: premium ? null : Math.max(0, limit - user.dailyQuestionsUsed),
  };
}

/**
 * Give back quota that was consumed for work that then failed.
 *
 * Charging a user for an AI call that errored is the kind of detail that
 * generates support tickets and refund requests, so every route that consumes
 * up-front must refund on failure.
 */
export async function refundQuota(userId, cost = 1) {
  await prisma.$executeRaw`
    UPDATE users
       SET daily_questions_used = GREATEST(0, daily_questions_used - ${cost})
     WHERE id = ${userId}
  `;
}

/** Throwing wrapper for routes that just need the gate. */
export async function requireQuota(userId, cost = 1) {
  const q = await consumeQuota(userId, cost);
  if (!q.allowed) {
    throw new HttpError(
      402,
      'Daily free limit reached',
      { used: q.used, limit: q.limit, remaining: 0 },
      'QUOTA_EXCEEDED',
    );
  }
  return q;
}

/** Read-only snapshot for /user/me and the home screen. */
export async function quotaSnapshot(user) {
  const today = cairoToday();
  const premium = hasPremium(user);
  const stale = !user.lastResetDate || user.lastResetDate < today;
  const used = stale ? 0 : user.dailyQuestionsUsed;
  return {
    plan: premium ? 'premium' : 'free',
    premiumUntil: user.premiumUntil ?? null,
    used,
    limit: premium ? null : freeDailyLimit(),
    remaining: premium ? null : Math.max(0, freeDailyLimit() - used),
  };
}

/** Cost in quota units per feature. Meetings are far more expensive than one answer. */
export const QUOTA_COST = {
  answer: 1,
  meetingTurn: 1,
  meetingPrepare: 2,
  meetingFinish: 2,
};
