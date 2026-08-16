/**
 * Periodic maintenance jobs, callable from both the in-process scheduler
 * (services/cron.js) and the HTTP cron routes.
 */

import { prisma } from '../db/prisma.js';
import { logger } from '../utils/logger.js';
import { expireSubscriptionBucket } from './billing/minutes.js';
import { grantCycle } from './billing/cycles.js';
import { sweepAbandonedMeetings } from './billing/meetings.js';

export { sweepAbandonedMeetings };

/**
 * Expire lapsed subscriptions and downgrade only the users who genuinely
 * have no remaining coverage.
 *
 * The previous implementation ran:
 *   UPDATE users SET plan='free' WHERE id IN (<every user with an expired row>)
 * which downgraded customers who had *just renewed* — their new active
 * subscription was ignored because the query only looked at the expired one.
 * Renewing early therefore cancelled your own access.
 */
export async function expireSubscriptions(now = new Date()) {
  const lapsed = await prisma.subscription.findMany({
    where: { status: 'active', expiresAt: { lt: now } },
    select: { id: true, userId: true },
  });

  if (!lapsed.length) return { subscriptionsExpired: 0, usersDowngraded: 0 };

  await prisma.subscription.updateMany({
    where: { id: { in: lapsed.map((s) => s.id) } },
    data: { status: 'expired' },
  });

  const affectedUserIds = [...new Set(lapsed.map((s) => s.userId))];
  let downgraded = 0;

  for (const userId of affectedUserIds) {
    // Does any other subscription still cover this user?
    const covering = await prisma.subscription.findFirst({
      where: { userId, status: 'active', expiresAt: { gt: now } },
      orderBy: { expiresAt: 'desc' },
      select: { expiresAt: true },
    });

    if (covering) {
      await prisma.user.update({
        where: { id: userId },
        data: { plan: 'premium', premiumUntil: covering.expiresAt },
      });
    } else {
      await prisma.user.update({
        where: { id: userId },
        data: { plan: 'free', premiumUntil: null },
      });
      downgraded += 1;
    }
  }

  logger.info('Subscription sweep', {
    subscriptionsExpired: lapsed.length,
    usersDowngraded: downgraded,
  });

  return { subscriptionsExpired: lapsed.length, usersDowngraded: downgraded };
}

/** Drop refresh tokens and password-reset tokens that can no longer be used. */
export async function purgeExpiredTokens(now = new Date()) {
  const [refresh, resets] = await Promise.all([
    prisma.refreshToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }] },
    }),
    prisma.passwordReset.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] },
    }),
  ]);
  return { refreshTokensPurged: refresh.count, passwordResetsPurged: resets.count };
}

/**
 * Reconcile the denormalised `premiumUntil` mirror against the subscriptions
 * table. Cheap insurance against drift if a webhook is ever mis-processed.
 */
export async function reconcilePremiumMirror(now = new Date()) {
  const active = await prisma.subscription.findMany({
    where: { status: 'active', expiresAt: { gt: now } },
    select: { userId: true, expiresAt: true },
    orderBy: { expiresAt: 'desc' },
  });

  const latest = new Map();
  for (const s of active) {
    if (!latest.has(s.userId.toString())) latest.set(s.userId.toString(), s.expiresAt);
  }

  let fixed = 0;
  for (const [userId, expiresAt] of latest) {
    const r = await prisma.user.updateMany({
      where: {
        id: BigInt(userId),
        OR: [{ plan: 'free' }, { premiumUntil: null }, { premiumUntil: { not: expiresAt } }],
      },
      data: { plan: 'premium', premiumUntil: expiresAt },
    });
    fixed += r.count;
  }

  return { premiumMirrorFixed: fixed };
}

/* ==================================================================== *
 * Minute metering
 * ==================================================================== */

/**
 * Grant each active subscription its allowance for the current 30-day cycle.
 *
 * Idempotent BY CONSTRUCTION rather than by bookkeeping: the cycle number is
 * derived from the subscription's own start date, so the key
 * `sub:<id>:cycle:<n>` is the same value however often this runs. Run it every
 * minute if you like — the unique index does the rest.
 *
 * A quarterly subscriber gets 300 minutes per cycle, not 900 up front, so
 * nobody can front-load a quarter's minutes into week one and cancel.
 *
 * An ACTIVE subscription whose plan code is not in the catalogue — the
 * `yearly_legacy` demo rows migration 002 renamed — falls through
 * cycleSecondsFor() to the monthly allowance. Those accounts keep working and
 * lapse naturally at their own expiry. No special case, no orphan.
 *
 * MANUAL GRANTS ARE EXCLUDED, and that exclusion is load-bearing. A goodwill
 * grant has no plan and no payment behind it, so cycleSecondsFor() fell back to
 * the monthly allowance and credited a FULL 300 minutes for it — one goodwill
 * day bought 300 minutes. Worse, the 'subscription' bucket REPLACES rather than
 * adds (services/billing/minutes.js), so the grant also wiped whatever the
 * customer had left of the cycle they paid for. Premium and minutes are
 * orthogonal here as everywhere: a manual subscription grants premium ACCESS,
 * and minutes are credited deliberately through POST /admin/users/:id/minutes,
 * where they carry a Payment row, a reason and an audit entry.
 *
 * THIS JOB IS NO LONGER THE ONLY WAY A CYCLE GETS CREDITED. It used to be, and
 * the gap between a cycle expiring and the next hourly run was a paying
 * subscriber being told to buy minutes. services/billing/cycles.js credits the
 * current cycle on the request path too, with the same key, so the two can
 * never both credit it. What this job is now for is dormant subscribers, whose
 * ledger should still show the cycle they were entitled to.
 */
export async function grantSubscriptionCycles(now = new Date()) {
  const active = await prisma.subscription.findMany({
    where: { status: 'active', expiresAt: { gt: now }, provider: { not: 'manual' } },
    select: { id: true, userId: true, planCode: true, startedAt: true, expiresAt: true },
    take: 1000,
  });

  let granted = 0;
  for (const sub of active) {
    try {
      const out = await grantCycle(sub, now);
      if (out.granted) granted += 1;
    } catch (err) {
      logger.error('cycle grant failed', { subscriptionId: String(sub.id), message: err.message });
    }
  }

  return { subscriptionCyclesGranted: granted, subscriptionsChecked: active.length };
}

/**
 * Zero out allowances whose cycle has passed, and write the ledger row.
 *
 * Enforcement does NOT depend on this job — validSubSeconds() refuses to spend
 * an allowance whose timestamp has passed, so a missed run cannot give anyone
 * free minutes. What the job is for is the LEDGER: without it the statement
 * shows a grant with no matching expiry and the nightly reconciliation reports
 * drift that is not really drift.
 *
 * RUN IT BEFORE grantSubscriptionCycles(), not after: a grant into the
 * subscription bucket REPLACES the counter, so a leftover allowance swept
 * afterwards no longer matches `subSecondsExpiresAt < now` and its expiry row
 * is never written. grantSeconds() now writes that row itself when it
 * supersedes an allowance, so the order is belt and braces rather than the only
 * defence — but the belt still goes on first.
 */
export async function expireSubscriptionMinutes(now = new Date()) {
  const stale = await prisma.user.findMany({
    where: { subSeconds: { gt: 0 }, subSecondsExpiresAt: { lt: now } },
    select: { id: true },
    take: 500,
  });

  let expired = 0;
  let seconds = 0;
  for (const u of stale) {
    try {
      const out = await expireSubscriptionBucket(u.id, 'cycle_expired');
      if (out.expired > 0) { expired += 1; seconds += out.expired; }
    } catch (err) {
      logger.error('allowance expiry failed', { userId: String(u.id), message: err.message });
    }
  }
  return { allowancesExpired: expired, allowanceSecondsExpired: seconds };
}

/**
 * Assert that the cached counters still agree with the ledger, and repair the
 * one piece of derived state that is safe to repair.
 *
 * TWO CHECKS, TREATED DIFFERENTLY ON PURPOSE:
 *
 * 1. `balance + sub` vs `SUM(time_ledger.seconds)` — REPORTED, NEVER REPAIRED.
 *    Auto-correcting a balance is how you silently paper over a double-spend;
 *    the whole reason `perpetual_after` is stamped on every ledger row is so
 *    the exact drifting row can be found instead of the symptom being erased.
 *    A mismatch here is a bug, and a bug should be loud.
 *
 * 2. `users.held_seconds` vs the sum of live meetings' holds — REPAIRED. A hold
 *    is derived state with a single correct value, and a stranded one silently
 *    strands a user's minutes: they can see a balance they cannot spend.
 */
export async function reconcileBalances() {
  const drift = await prisma.$queryRaw`
    SELECT u.id                                        AS userId,
           u.balance_seconds + u.sub_seconds           AS counters,
           COALESCE(SUM(l.seconds), 0)                 AS ledgerSum
      FROM users u
      LEFT JOIN time_ledger l ON l.user_id = u.id
     GROUP BY u.id, u.balance_seconds, u.sub_seconds
    HAVING counters <> ledgerSum
     LIMIT 100
  `;

  for (const row of drift ?? []) {
    // Loud, and with both numbers, so the next step is a SELECT rather than an
    // investigation.
    logger.error('BALANCE DRIFT: counters disagree with the ledger', {
      userId: String(row.userId),
      counters: Number(row.counters),
      ledgerSum: Number(row.ledgerSum),
      delta: Number(row.counters) - Number(row.ledgerSum),
    });
  }

  const held = await prisma.$queryRaw`
    SELECT u.id AS userId,
           u.held_seconds AS stored,
           COALESCE((SELECT SUM(m.held_seconds) FROM meeting_sessions m
                      WHERE m.user_id = u.id AND m.status = 'live'), 0) AS live
      FROM users u
     WHERE u.held_seconds <> 0
     LIMIT 500
  `;

  let repaired = 0;
  for (const row of held ?? []) {
    const live = Number(row.live);
    if (Number(row.stored) === live) continue;
    await prisma.$executeRaw`
      UPDATE users SET held_seconds = ${live} WHERE id = ${row.userId}
    `;
    repaired += 1;
    logger.warn('repaired stranded hold', {
      userId: String(row.userId), was: Number(row.stored), now: live,
    });
  }

  return { balanceDrifts: (drift ?? []).length, holdsRepaired: repaired };
}
