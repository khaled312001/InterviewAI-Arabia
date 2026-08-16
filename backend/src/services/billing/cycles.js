/**
 * Subscription cycle allowances — when they are credited, and by whom.
 *
 * A subscription does not buy minutes once; it buys `subscription_cycle_seconds`
 * every 30 days for as long as it is active. The cycle number is derived from
 * the subscription's own `startedAt`, so the idempotency key `sub:<id>:cycle:<n>`
 * is the same value however often this runs — the grant is idempotent BY
 * CONSTRUCTION rather than by bookkeeping, and it is safe to call from anywhere.
 *
 * WHICH IS THE POINT OF THIS MODULE. The hourly job used to be the only thing
 * that credited cycle N>0, and `validSubSeconds()` is a pure timestamp
 * comparison with no grace period — so between the instant cycle N expired and
 * the instant the job next ran, a fully paid-up subscriber had a zero balance
 * and was shown a 402 that upsold them time packs. Up to 59 minutes of that on
 * the Hostinger box, and on any deploy where the in-process scheduler does not
 * run at all it is however long the external pinger takes: up to a day.
 *
 * `ensureCurrentCycle()` closes the window by making the REQUEST path able to
 * credit the cycle itself. The hourly job stays — it is what keeps the ledger
 * moving for dormant subscribers — but nothing depends on it having run.
 *
 * It lives in its own file rather than in services/maintenance.js because
 * services/billing/meetings.js has to call it and maintenance.js imports
 * meetings.js; putting it there would make the cycle a literal one.
 */

import { prisma } from '../../db/prisma.js';
import { logger } from '../../utils/logger.js';
import { grantSeconds, loadBalanceUser, validSubSeconds, hasPremium, CYCLE_MS } from './minutes.js';
import { cycleSecondsFor } from '../payments/plans.js';

/**
 * Which cycle a subscription is in right now, and when that cycle's allowance
 * dies: at the end of its own 30 days or with the subscription, whichever is
 * sooner. Cycle minutes do not roll over — that is stated on the paywall, and
 * it is what makes the pack's "never expires" mean something.
 */
export function cycleWindow(sub, now = new Date()) {
  const elapsedMs = now.getTime() - sub.startedAt.getTime();
  if (elapsedMs < 0) return null;
  const cycle = Math.floor(elapsedMs / CYCLE_MS);
  const cycleEnd = new Date(sub.startedAt.getTime() + (cycle + 1) * CYCLE_MS);
  return { cycle, expiresAt: cycleEnd < sub.expiresAt ? cycleEnd : sub.expiresAt };
}

/** Credit one subscription its allowance for whichever cycle it is in now. */
export async function grantCycle(sub, now = new Date()) {
  const window = cycleWindow(sub, now);
  if (!window) return { granted: false, reason: 'not_started' };

  return grantSeconds({
    userId: sub.userId,
    seconds: cycleSecondsFor(sub.planCode),
    kind: 'subscription_grant',
    bucket: 'subscription',
    subscriptionId: sub.id,
    idempotencyKey: `sub:${sub.id}:cycle:${window.cycle}`,
    expiresAt: window.expiresAt,
    note: `${sub.planCode} cycle ${window.cycle}`,
  });
}

/**
 * The lazy top-up, called from the request path.
 *
 * Cheap in the common case: it does nothing at all unless the caller is a
 * premium user whose allowance currently reads zero, which is true only in the
 * gap between one cycle ending and the next being credited. Manual (goodwill)
 * subscriptions are excluded for the same reason the hourly job excludes them —
 * they grant ACCESS, not minutes, and cycleSecondsFor() would otherwise credit
 * a full monthly allowance for one hand-made row.
 */
export async function ensureCurrentCycle(userId, now = new Date(), user = null) {
  let state = user;
  try {
    if (!state) state = await loadBalanceUser(userId);
  } catch {
    return { granted: false, reason: 'no_user' };
  }

  if (!hasPremium(state, now)) return { granted: false, reason: 'not_premium' };
  if (validSubSeconds(state, now) > 0) return { granted: false, reason: 'still_valid' };

  const sub = await prisma.subscription.findFirst({
    where: {
      userId: state.id,
      status: 'active',
      expiresAt: { gt: now },
      provider: { not: 'manual' },
    },
    orderBy: { expiresAt: 'desc' },
    select: { id: true, userId: true, planCode: true, startedAt: true, expiresAt: true },
  });
  if (!sub) return { granted: false, reason: 'no_active_subscription' };

  try {
    const out = await grantCycle(sub, now);
    if (out.granted) {
      logger.info('subscription cycle credited on the request path', {
        userId: String(state.id), subscriptionId: String(sub.id),
      });
    }
    return out;
  } catch (err) {
    // A subscriber must never see a 500 because a top-up raced with the hourly
    // job. Worst case they fall through to the balance they already had.
    logger.error('lazy cycle grant failed', { userId: String(state.id), message: err.message });
    return { granted: false, reason: 'error' };
  }
}
