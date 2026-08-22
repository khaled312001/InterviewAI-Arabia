/**
 * Periodic maintenance jobs, callable from both the in-process scheduler
 * (services/cron.js) and the HTTP cron routes.
 */

import { prisma } from '../db/prisma.js';
import { logger } from '../utils/logger.js';
import { expireSubscriptionBucket } from './billing/minutes.js';
import { grantCycle } from './billing/cycles.js';
import { sweepAbandonedMeetings } from './billing/meetings.js';
import { notifyTrialReminder } from './push/notify.js';

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

/* ==================================================================== *
 * Trial reminders
 * ==================================================================== */

/**
 * The age window in which a dormant trial is worth a nudge.
 *
 * THE CEILING IS NOT TIDINESS, IT IS THE FIRST-RUN GUARD. Without it the very
 * first execution of this job selects every account ever registered that never
 * opened an interview — the whole back catalogue — and pushes all of them in
 * one batch, months late, several of them to people who deleted the app long
 * ago. Reminding someone three days after they signed up is a nudge; reminding
 * them eight months later is spam with a backlog behind it, and it arrives as
 * one burst that looks exactly like a compromised push key.
 *
 * The floor is the other half: fire it the same day and it lands on someone who
 * is still deciding whether to open the app this evening.
 */
const TRIAL_REMINDER_AFTER_DAYS = 3;
const TRIAL_REMINDER_UNTIL_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Remind the accounts that were granted the free trial and never spent a
 * second of it.
 *
 * WHY THIS IS A CRON JOB AND NOT A HOOK ON ensureTrialGranted(): the thing
 * worth notifying about is an ABSENCE — "you still have not started" — and an
 * absence has no moment to hang a hook on. The grant is the wrong trigger
 * twice over: it happens on /user/balance while the user is looking at the
 * home screen that just granted it, and it says nothing whatsoever about
 * whether they went on to use it.
 *
 * "UNTOUCHED" IS READ FROM THE LEDGER, NEVER FROM THE BALANCE. `balance_seconds
 * = trial_seconds` looks like the obvious test and is wrong in both directions:
 * an admin grant lifts the balance above the trial without the user having done
 * anything, and a user who ran an interview that was later refunded lands back
 * on the same number. One `consumption` row is proof they started; no such row
 * is proof they did not.
 *
 * ONE REMINDER PER ACCOUNT, EVER, and it is claimed rather than looked up. This
 * job runs from two places on purpose — the in-process scheduler and an
 * external pinger on /api/cron/trial-reminders, because a Passenger recycle
 * kills the first — so "SELECT who has no reminder yet, then send" is a
 * read-then-write that two runners in the same minute both win. The conditional
 * UPDATE on `trial_reminded_at` has no such window: the WHERE clause IS the
 * check, exactly as `trial_granted_at IS NULL` is for the grant itself.
 *
 * THE CLAIM IS TAKEN BEFORE THE SEND AND IS NOT ROLLED BACK IF THE SEND FAILS.
 * That is the deliberate direction to fail in: a reminder nobody receives costs
 * one conversion, a reminder delivered twice costs the notification permission
 * for everything else this app will ever need to say.
 *
 * AND IT ONLY CONSIDERS ACCOUNTS WITH A LIVE DEVICE TOKEN. Without that clause
 * the claim is burned on every account that registered on the web and never
 * installed the app: `sendNotification()` writes its audit row and reports
 * sent=0, the column says "reminded", and the one reminder those users were
 * owed was spent on nobody. With it, the claim is only ever spent on a handset
 * that could actually have rung.
 */
export async function remindDormantTrials(now = new Date()) {
  const after = new Date(now.getTime() - TRIAL_REMINDER_AFTER_DAYS * DAY_MS);
  const until = new Date(now.getTime() - TRIAL_REMINDER_UNTIL_DAYS * DAY_MS);

  const due = await prisma.$queryRaw`
    SELECT u.id AS userId
      FROM users u
     WHERE u.is_disabled = 0
       AND u.trial_reminded_at IS NULL
       AND u.trial_granted_at IS NOT NULL
       AND u.trial_granted_at < ${after}
       AND u.trial_granted_at > ${until}
       AND u.trial_seconds > 0
       AND NOT EXISTS (SELECT 1 FROM time_ledger l
                        WHERE l.user_id = u.id AND l.kind = 'consumption')
       AND EXISTS (SELECT 1 FROM device_tokens d
                    WHERE d.user_id = u.id AND d.disabled_at IS NULL)
     LIMIT 200
  `;

  let sent = 0;
  let claimed = 0;

  for (const row of due ?? []) {
    // The claim is the check. Zero rows means another runner took this user
    // between the SELECT above and now, and we send nothing at all.
    const won = await prisma.$executeRaw`
      UPDATE users SET trial_reminded_at = ${now}
       WHERE id = ${row.userId} AND trial_reminded_at IS NULL
    `;
    if (won === 0) continue;
    claimed += 1;

    // Awaited, because nothing here is inside a transaction and a sequential
    // walk is what fcm.js expects — but never allowed to throw: one unreachable
    // user must not abandon the rest of the batch, and the claim above already
    // stands whatever happens next.
    const out = await notifyTrialReminder(row.userId).catch((err) => {
      logger.warn('trial reminder failed', { userId: String(row.userId), message: err.message });
      return null;
    });
    if (out?.sent > 0) sent += 1;
  }

  return { trialRemindersClaimed: claimed, trialRemindersSent: sent };
}
