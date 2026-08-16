/**
 * The minute balance — grants, spends, and the ledger behind both.
 *
 * This replaces the daily question counter that services/quota.js metered.
 * What carried over from that file, deliberately and completely, is its one
 * hard rule:
 *
 *   THERE IS NO WINDOW BETWEEN CHECKING A BALANCE AND SPENDING IT.
 *
 * quota.js earned that rule the expensive way: sessions.js used to read the
 * counter, compare it, call the AI, and only then increment, so ten concurrent
 * requests all read "4 used" and all passed a five-call limit. Every path in
 * here closes that window one of two ways:
 *
 *   1. A single conditional UPDATE whose WHERE clause *is* the check —
 *      `hold()` and `ensureTrialGranted()`. Nothing can interleave inside one
 *      statement.
 *   2. `SELECT … FOR UPDATE` inside a transaction, which pins the user row for
 *      the whole read-decide-write cycle — `chargeLocked()` and everything
 *      built on it. Concurrent charges queue on the lock instead of racing.
 *
 * Option 2 exists because a charge has to be SPLIT across two buckets, and the
 * split has to be recorded exactly. The design's alternative was one statement
 * doing the split arithmetic inline:
 *
 *     SET balance_seconds = f(sub_seconds), sub_seconds = g(sub_seconds)
 *
 * which works, but only while nobody reorders those two SET clauses: MySQL
 * evaluates SET left to right and later expressions see the ALREADY-UPDATED
 * value of earlier columns, so swapping the lines double-charges every
 * subscriber, silently, with no test failing. Computing the split in JS under a
 * row lock makes the two assignments independent of each other — a reorder
 * becomes harmless — and gives the ledger the exact per-bucket numbers it needs
 * to be auditable. Same atomicity, one fewer footgun.
 *
 * TWO BUCKETS, AND THE ORDER MATTERS:
 *   perpetual    users.balance_seconds  — trial, packs, admin grants. Never expires.
 *   subscription users.sub_seconds      — the cycle allowance. Expires with the cycle.
 *
 * Subscription seconds are ALWAYS spent first. Spend the perishable currency
 * before the permanent one, or a subscriber burns minutes they paid cash for
 * while the allowance they also paid for evaporates on a timer — the most
 * predictable support ticket in the whole design.
 *
 * Everything is integer SECONDS. Minutes are a display unit; storing the
 * display unit is how a "60 minute" pack quietly becomes 45 usable minutes.
 */

import crypto from 'node:crypto';

import { prisma } from '../../db/prisma.js';
import { seconds as secondsSetting } from '../appSettings.js';
import { HttpError } from '../../utils/asyncHandler.js';
import { logger } from '../../utils/logger.js';
import { env } from '../../config/env.js';
import { PACK_CODES } from '../payments/plans.js';

/**
 * True when the user currently holds premium access.
 *
 * Moved here from services/quota.js (which now re-exports it) because the
 * charging paths need it and importing it back out of quota.js would make the
 * two modules circular. The logic is unchanged and still load-bearing:
 *
 * reads the denormalised `premiumUntil` rather than joining subscriptions, so
 * it is cheap enough for every request; and `plan` alone is never trusted,
 * because if the expiry sweep fails to run — it did not run at all on the
 * serverless deploy — `plan` stays 'premium' forever and one payment buys
 * lifetime access.
 *
 * Premium and minutes are ORTHOGONAL. A pack buyer has minutes and no premium;
 * a subscriber has both. Never conflate them: PREMIUM_REQUIRED still means
 * "this category is premium-only", and QUOTA_EXCEEDED still means "out of
 * minutes".
 */
export function hasPremium(user, now = new Date()) {
  if (!user) return false;
  return user.plan === 'premium' && !!user.premiumUntil && user.premiumUntil > now;
}

/* ------------------------------------------------------------------ *
 * Tunables. Every one is an app_settings row, so pricing and generosity
 * are operator decisions rather than deploys — and `free_trial_seconds`
 * doubles as the kill switch if trial farming ever starts.
 * ------------------------------------------------------------------ */

export const CFG = {
  trial: () => secondsSetting('free_trial_seconds'),
  tick: () => secondsSetting('meeting_tick_seconds'),
  maxGap: () => secondsSetting('meeting_max_gap_seconds'),
  abandonAfter: () => secondsSetting('meeting_abandon_seconds'),
  holdWindow: () => secondsSetting('meeting_hold_seconds'),
  minStart: () => secondsSetting('meeting_min_start_seconds'),
  minTurn: () => secondsSetting('meeting_min_turn_seconds'),
  lowWater: () => secondsSetting('meeting_low_water_seconds'),
  cvPrepare: () => secondsSetting('cv_prepare_seconds'),
  practiceAnswer: () => secondsSetting('practice_answer_seconds'),
  subscriptionCycle: () => secondsSetting('subscription_cycle_seconds'),
  /**
   * The ceiling on billable time between two consecutive /turn calls of a
   * client that sends no heartbeat. See advanceMeeting(): the max-gap rule
   * cannot apply to a meeting that never promised a heartbeat, or every
   * inter-turn interval is billed at zero and a thirty-minute interview costs
   * fifteen turn floors.
   */
  turnGap: () => secondsSetting('meeting_turn_gap_seconds'),
};

/** 30 days, in ms — one subscription allowance cycle. */
export const CYCLE_MS = 30 * 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ *
 * Pure helpers
 * ------------------------------------------------------------------ */

const int = (n) => (Number.isFinite(Number(n)) ? Math.trunc(Number(n)) : 0);
const clamp0 = (n) => Math.max(0, int(n));

/**
 * Subscription seconds that are actually spendable right now.
 *
 * An expired cycle's leftovers are worth zero even though the column still
 * holds a number — expiry is a timestamp comparison, not a nightly job that
 * might not have run. (The job exists too, to write the ledger row; this is
 * what makes a missed run harmless.)
 */
export function validSubSeconds(u, now = new Date()) {
  if (!u?.subSecondsExpiresAt) return 0;
  const expires = u.subSecondsExpiresAt instanceof Date
    ? u.subSecondsExpiresAt
    : new Date(u.subSecondsExpiresAt);
  return expires > now ? clamp0(u.subSeconds) : 0;
}

/** What the user can still commit: both buckets, minus outstanding holds. */
export function availableSeconds(u, now = new Date()) {
  return Math.max(0, validSubSeconds(u, now) + clamp0(u.balanceSeconds) - clamp0(u.heldSeconds));
}

/**
 * Minutes for display, ALWAYS rounded down.
 *
 * Understating by <1 minute errs in the user's favour. Rounding up produces
 * "it said 5 minutes and cut me off at 4", which is the same bug as lying.
 */
export function toMinutes(sec) {
  return Math.floor(clamp0(sec) / 60);
}

/** The 402 body. `code` is reused verbatim so old app builds still paywall. */
export function quotaError(details = {}) {
  return new HttpError(
    402,
    'لم يتبقَّ رصيد من دقائق المقابلات / You have run out of interview minutes',
    { reason: 'insufficient_minutes', packs: PACK_CODES, ...details },
    'QUOTA_EXCEEDED',
  );
}

/* ------------------------------------------------------------------ *
 * Row locking
 * ------------------------------------------------------------------ */

/**
 * Load the user's balance row and hold an exclusive lock on it until the
 * transaction commits. Every concurrent charge for the same user serialises
 * here, which is what makes the read-decide-write below race-free.
 */
export async function lockUser(tx, userId) {
  const rows = await tx.$queryRaw`
    SELECT id,
           is_disabled            AS isDisabled,
           plan,
           premium_until          AS premiumUntil,
           balance_seconds        AS balanceSeconds,
           sub_seconds            AS subSeconds,
           sub_seconds_expires_at AS subSecondsExpiresAt,
           held_seconds           AS heldSeconds,
           trial_granted_at       AS trialGrantedAt,
           trial_seconds          AS trialSeconds
      FROM users
     WHERE id = ${userId}
     FOR UPDATE
  `;
  const row = rows?.[0];
  if (!row) throw new HttpError(404, 'User not found');
  return {
    id: row.id,
    isDisabled: Boolean(Number(row.isDisabled)),
    plan: row.plan,
    premiumUntil: row.premiumUntil,
    balanceSeconds: int(row.balanceSeconds),
    subSeconds: int(row.subSeconds),
    subSecondsExpiresAt: row.subSecondsExpiresAt,
    heldSeconds: int(row.heldSeconds),
    trialGrantedAt: row.trialGrantedAt,
    trialSeconds: int(row.trialSeconds),
  };
}

/* ------------------------------------------------------------------ *
 * The ledger
 * ------------------------------------------------------------------ */

/**
 * Append one ledger row. NEVER updated, NEVER deleted — a correction is
 * another row. This is the answer to "where did my minutes go?", and with zero
 * paying customers today it is the cheapest it will ever be to start keeping.
 *
 * Throws on a duplicate `idempotencyKey` (Prisma P2002). Callers that grant
 * seconds write the ledger row BEFORE touching the counter, precisely so a
 * replayed webhook aborts the transaction instead of crediting twice.
 */
export async function writeLedger(tx, entry) {
  return tx.timeLedgerEntry.create({
    data: {
      userId: entry.userId,
      kind: entry.kind,
      bucket: entry.bucket ?? 'perpetual',
      seconds: int(entry.seconds),
      perpetualAfter: int(entry.perpetualAfter),
      subscriptionAfter: int(entry.subscriptionAfter),
      paymentId: entry.paymentId ?? null,
      subscriptionId: entry.subscriptionId ?? null,
      meetingSessionId: entry.meetingSessionId ?? null,
      adminId: entry.adminId ?? null,
      idempotencyKey: entry.idempotencyKey ?? null,
      note: entry.note ? String(entry.note).slice(0, 255) : null,
    },
  });
}

export function isDuplicateKey(err) {
  return err?.code === 'P2002';
}

/* ------------------------------------------------------------------ *
 * Charging
 * ------------------------------------------------------------------ */

/**
 * Spend `amount` seconds from a LOCKED user row, subscription bucket first.
 *
 * Returns a receipt: the exact per-bucket split, which is what makes a later
 * refund land back in the bucket the seconds came from. That matters — refunding
 * subscription seconds into the perpetual bucket would quietly convert a
 * perishable allowance into permanent credit.
 *
 * `amount` is a REQUEST, not a guarantee. When the balance cannot cover it the
 * charge is clamped to whatever exists and `charged < amount`: that clamp is
 * the deliberate goodwill overdraft on the closing turn of an exhausted
 * interview. Callers that must not overdraft check availability first, under
 * this same lock.
 */
export async function chargeLocked(tx, state, amount, opts = {}) {
  const { now = new Date(), releaseHold = 0, kind = 'consumption' } = opts;
  const want = clamp0(amount);
  const release = Math.min(clamp0(releaseHold), state.heldSeconds);

  const validSub = validSubSeconds(state, now);
  // Perishable first. Always.
  const subUsed = Math.min(want, validSub);
  const perpUsed = Math.min(want - subUsed, clamp0(state.balanceSeconds));
  const charged = subUsed + perpUsed;

  if (charged === 0 && release === 0) {
    return { charged: 0, subUsed: 0, perpUsed: 0, shortfall: want, state };
  }

  // The three assignments are mutually independent — each column's new value
  // is a literal computed above, not an expression over a sibling column — so
  // MySQL's left-to-right SET evaluation cannot make the order load-bearing.
  await tx.$executeRaw`
    UPDATE users
       SET balance_seconds = GREATEST(0, balance_seconds - ${perpUsed}),
           sub_seconds     = GREATEST(0, sub_seconds - ${subUsed}),
           held_seconds    = GREATEST(0, held_seconds - ${release})
     WHERE id = ${state.id}
  `;

  const next = {
    ...state,
    balanceSeconds: Math.max(0, state.balanceSeconds - perpUsed),
    subSeconds: Math.max(0, state.subSeconds - subUsed),
    heldSeconds: Math.max(0, state.heldSeconds - release),
  };

  // One row per bucket touched, so per-bucket reconciliation stays exact.
  // A charge that spans both buckets is rare (only when an allowance runs out
  // mid-interview) and is worth two rows on the statement rather than one row
  // that lies about which pocket the seconds came from.
  const base = {
    userId: state.id,
    kind,
    perpetualAfter: next.balanceSeconds,
    subscriptionAfter: next.subSeconds,
    meetingSessionId: opts.meetingSessionId ?? null,
    note: opts.note ?? null,
  };
  const key = opts.idempotencyKey;
  if (subUsed > 0) {
    await writeLedger(tx, {
      ...base, bucket: 'subscription', seconds: -subUsed,
      idempotencyKey: key ? `${key}:sub` : null,
    });
  }
  if (perpUsed > 0) {
    await writeLedger(tx, {
      ...base, bucket: 'perpetual', seconds: -perpUsed,
      idempotencyKey: key ? `${key}:perp` : null,
    });
  }

  return { charged, subUsed, perpUsed, shortfall: want - charged, state: next };
}

/**
 * Put seconds back into the buckets they came from.
 *
 * The rule quota.js established and this must keep: a model call that FAILED
 * costs the user nothing. Every route that charges before calling the AI
 * refunds on the way out of the catch block.
 */
export async function refundLocked(tx, state, receipt, opts = {}) {
  const subBack = clamp0(receipt?.subUsed);
  const perpBack = clamp0(receipt?.perpUsed);
  if (subBack === 0 && perpBack === 0) return state;

  await tx.$executeRaw`
    UPDATE users
       SET balance_seconds = balance_seconds + ${perpBack},
           sub_seconds     = sub_seconds + ${subBack}
     WHERE id = ${state.id}
  `;

  const next = {
    ...state,
    balanceSeconds: state.balanceSeconds + perpBack,
    subSeconds: state.subSeconds + subBack,
  };

  const base = {
    userId: state.id,
    kind: 'refund',
    perpetualAfter: next.balanceSeconds,
    subscriptionAfter: next.subSeconds,
    meetingSessionId: opts.meetingSessionId ?? null,
    note: opts.note ?? null,
  };
  if (subBack > 0) await writeLedger(tx, { ...base, bucket: 'subscription', seconds: subBack });
  if (perpBack > 0) await writeLedger(tx, { ...base, bucket: 'perpetual', seconds: perpBack });

  return next;
}

/* ------------------------------------------------------------------ *
 * Flat charges — practice answers and CV analysis
 * ------------------------------------------------------------------ */

/**
 * Charge a fixed number of seconds, refusing if the balance cannot cover it.
 *
 * Subscribers are exempt: free practice answers and free CV analysis are two of
 * the things that make the subscription more than a bulk discount. `exempt`
 * comes back on the receipt so the refund path knows there is nothing to undo.
 *
 * Returns a receipt to hand to `refundFlat()` if the work then fails.
 */
export async function chargeFlat({ userId, seconds, kind = 'consumption', note, meetingSessionId }) {
  const want = clamp0(seconds);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const state = await lockUser(tx, userId);
    if (state.isDisabled) {
      throw new HttpError(403, 'هذا الحساب موقوف / This account is suspended', undefined, 'ACCOUNT_DISABLED');
    }
    if (hasPremium(state, now) || want === 0) {
      return { charged: 0, subUsed: 0, perpUsed: 0, exempt: hasPremium(state, now), userId };
    }

    const available = availableSeconds(state, now);
    if (available < want) {
      throw quotaError({
        balanceSeconds: available,
        requiredSeconds: want,
        trialUsed: Boolean(state.trialGrantedAt),
      });
    }

    const receipt = await chargeLocked(tx, state, want, { now, kind, note, meetingSessionId });
    return { ...receipt, exempt: false, userId };
  });
}

/** Undo a `chargeFlat()` after the work it paid for failed. Never throws. */
export async function refundFlat(receipt, note = 'ai_unavailable') {
  if (!receipt || receipt.exempt || (!receipt.subUsed && !receipt.perpUsed)) return;
  try {
    await prisma.$transaction(async (tx) => {
      const state = await lockUser(tx, receipt.userId);
      await refundLocked(tx, state, receipt, { note, meetingSessionId: receipt.meetingSessionId ?? null });
    });
  } catch (err) {
    // A failed refund must not turn a 503 into a 500 — the user already has an
    // error; log loudly and let reconciliation surface it.
    logger.error('minute refund failed', {
      userId: String(receipt.userId), seconds: receipt.charged, message: err.message,
    });
  }
}

/* ------------------------------------------------------------------ *
 * Holds
 * ------------------------------------------------------------------ */

/**
 * Reserve seconds against the balance in ONE statement.
 *
 * A hold is a lease, not a spend: it is what stops two devices from committing
 * the same minute twice, and it is stored in the database rather than in memory
 * so a Passenger recycle cannot lose it. The WHERE clause is the availability
 * check, so there is no window between deciding and reserving.
 *
 * NOTE THE BOUND `now` WHERE `NOW(3)` WOULD BE NATURAL, AND DO NOT "SIMPLIFY"
 * IT BACK. Prisma writes and reads DATETIME columns in UTC, while MySQL's
 * NOW(3) returns the SERVER's local time — and both the Hostinger box and a
 * developer's XAMPP run `time_zone = SYSTEM`, three hours off UTC. Comparing a
 * Prisma-written expiry against NOW(3) therefore judges a subscription with two
 * hours left to be already expired, and silently strips a paying subscriber of
 * their allowance. Every timestamp comparison in this codebase must use a value
 * the application supplied, so both sides speak the same clock.
 */
export async function hold(userId, seconds, tx = prisma, now = new Date()) {
  const want = clamp0(seconds);
  if (want === 0) return true;
  const updated = await tx.$executeRaw`
    UPDATE users
       SET held_seconds = held_seconds + ${want}
     WHERE id = ${userId}
       AND is_disabled = 0
       AND (
         (CASE WHEN sub_seconds_expires_at IS NOT NULL AND sub_seconds_expires_at > ${now}
               THEN sub_seconds ELSE 0 END)
         + balance_seconds - held_seconds
       ) >= ${want}
  `;
  return updated > 0;
}

/** Give a reservation back. Clamped at zero: a hold is never negative. */
export async function releaseHold(userId, seconds, tx = prisma) {
  const give = clamp0(seconds);
  if (give === 0) return;
  await tx.$executeRaw`
    UPDATE users
       SET held_seconds = GREATEST(0, held_seconds - ${give})
     WHERE id = ${userId}
  `;
}

/* ------------------------------------------------------------------ *
 * Grants
 * ------------------------------------------------------------------ */

/**
 * Credit seconds. The ONE function every purchase, promo and admin gift goes
 * through.
 *
 * The order inside the transaction is load-bearing:
 *
 *   1. lock the user row
 *   2. INSERT the ledger row  ← unique idempotency key rejects a replay here
 *   3. UPDATE the counter
 *
 * Written the other way round, a webhook retry would credit the minutes and
 * *then* discover the ledger row already existed — which is exactly the
 * double-grant bug the payments webhook was rewritten to eliminate. A duplicate
 * key aborts before any credit happens.
 *
 * Returns `{ granted: false, duplicate: true }` on a replay, never an error:
 * a gateway retrying a webhook it already delivered is normal traffic.
 *
 * `tx` JOINS AN EXISTING TRANSACTION instead of opening one. A caller that
 * writes a Payment row and then credits the minutes it paid for must do both or
 * neither: POST /admin/users/:id/minutes used to create the payment, call this,
 * and hope — a lock-wait timeout inside here left recorded revenue with no
 * minutes behind it and no audit row at all. With an external `tx` a duplicate
 * key THROWS rather than being reported, because the caller's transaction is
 * already doomed at that point and must roll back rather than continue.
 */
export async function grantSeconds({
  userId, seconds, kind, bucket = 'perpetual', idempotencyKey, note,
  paymentId, subscriptionId, adminId, expiresAt, tx: externalTx = null,
}) {
  const amount = clamp0(seconds);
  if (amount === 0) return { granted: false, reason: 'zero_seconds' };

  const run = async (tx) => {
    const state = await lockUser(tx, userId);

    const perpetualAfter = bucket === 'perpetual'
      ? state.balanceSeconds + amount
      : state.balanceSeconds;
    // A new cycle REPLACES the old allowance rather than stacking: cycle
    // minutes do not roll over, and that is stated on the paywall.
    const subscriptionAfter = bucket === 'subscription'
      ? amount
      : state.subSeconds;

    // ...and "replaces" means the leftover is DESTROYED, so it gets its own
    // expiry row, here, in the same transaction, before the grant.
    //
    // Without it the statement showed a +300-minute grant while the counter
    // rose by 50, the ledger sum stopped matching the counters, and
    // reconcileBalances() logged BALANCE DRIFT on every single renewal — which
    // would have trained everyone to ignore the one alarm that catches a real
    // double-spend. Ordering the job as expire-then-grant is not enough on its
    // own: the previous cycle's expiry can only be swept once its timestamp has
    // passed, and an early renewal or a manual re-grant lands before that.
    //
    // The key is derived from the grant's own idempotency key, so a replayed
    // grant collides here first and the whole transaction rolls back rather
    // than expiring an allowance twice.
    if (bucket === 'subscription') {
      const leftover = clamp0(state.subSeconds);
      if (leftover > 0) {
        await writeLedger(tx, {
          userId, kind: 'expiry', bucket: 'subscription', seconds: -leftover,
          perpetualAfter: state.balanceSeconds, subscriptionAfter: 0,
          subscriptionId,
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:supersede` : null,
          note: 'previous cycle allowance, not rolled over',
        });
      }
    }

    await writeLedger(tx, {
      userId, kind, bucket, seconds: amount,
      perpetualAfter, subscriptionAfter,
      paymentId, subscriptionId, adminId, idempotencyKey, note,
    });

    if (bucket === 'perpetual') {
      await tx.$executeRaw`
        UPDATE users SET balance_seconds = balance_seconds + ${amount} WHERE id = ${userId}
      `;
    } else {
      await tx.$executeRaw`
        UPDATE users
           SET sub_seconds = ${amount},
               sub_seconds_expires_at = ${expiresAt ?? new Date(Date.now() + CYCLE_MS)}
         WHERE id = ${userId}
      `;
    }

    return { granted: true, seconds: amount, bucket, perpetualAfter, subscriptionAfter };
  };

  if (externalTx) return run(externalTx);

  try {
    return await prisma.$transaction(run);
  } catch (err) {
    if (isDuplicateKey(err)) {
      logger.info('minute grant already applied', { idempotencyKey, userId: String(userId) });
      return { granted: false, duplicate: true, reason: 'already_granted' };
    }
    throw err;
  }
}

/**
 * Take seconds back — a refunded or charged-back purchase.
 *
 * Two rules, both deliberate:
 *
 * 1. CLAMPED AT THE CURRENT BALANCE. A refund can arrive after the minutes are
 *    gone; driving the balance negative would silently bill the user's NEXT
 *    purchase for the one they got their money back on. Only unspent minutes
 *    come back: `min(granted, currentBalance)`. Whoever owns the policy still
 *    has to decide what happens when someone spends 55 of 60 minutes and then
 *    charges back — the ledger makes that arguable, not painless.
 *
 * 2. A NEGATIVE ROW, never a deleted grant. Deleting the original destroys the
 *    audit trail that justified the refund in the first place.
 *
 * 3. ONLY THE PERPETUAL BUCKET. Subscription seconds are not ours to take back
 *    one at a time — they are a cycle allowance that expires wholesale, which
 *    is what expireSubscriptionBucket() is for. Anything the admin panel or a
 *    refund removes therefore comes out of `balance_seconds`, and the UI has to
 *    say so or an operator will expect a deduction they cannot see.
 *
 * `tx` joins an existing transaction, for the same reason grantSeconds() takes
 * one: a caller that also writes an audit row must do both or neither. With an
 * external `tx` a duplicate key THROWS instead of being reported, because the
 * caller's transaction is already doomed and must roll back.
 */
export async function clawbackSeconds({
  userId, seconds, kind = 'refund', idempotencyKey, note, paymentId, adminId,
  tx: externalTx = null,
}) {
  const want = clamp0(seconds);
  if (want === 0) return { clawed: 0 };

  const run = async (tx) => {
    const state = await lockUser(tx, userId);
    const take = Math.min(want, clamp0(state.balanceSeconds));

    // Still write the row when take is 0: "we tried to reverse 3600 seconds
    // and 0 were left" is exactly the fact support needs.
    await writeLedger(tx, {
      userId, kind, bucket: 'perpetual', seconds: -take,
      perpetualAfter: state.balanceSeconds - take,
      subscriptionAfter: state.subSeconds,
      paymentId, adminId, idempotencyKey,
      note: note ?? `reversal of ${want}s, ${want - take}s already spent`,
    });

    if (take > 0) {
      await tx.$executeRaw`
        UPDATE users
           SET balance_seconds = GREATEST(0, balance_seconds - ${take})
         WHERE id = ${userId}
      `;
    }
    return { clawed: take, unrecovered: want - take };
  };

  if (externalTx) return run(externalTx);

  try {
    return await prisma.$transaction(run);
  } catch (err) {
    if (isDuplicateKey(err)) return { clawed: 0, duplicate: true };
    throw err;
  }
}

/**
 * Zero the subscription bucket and record why.
 *
 * Used by the hourly expiry sweep and by the refund path. Without it a lapsed —
 * or refunded — subscriber keeps spending an allowance they no longer pay for
 * until the timestamp happens to pass. `validSubSeconds()` already refuses to
 * spend an expired allowance, so this job is about the LEDGER telling the truth
 * rather than about enforcement; the enforcement is the timestamp.
 */
export async function expireSubscriptionBucket(userId, note = 'cycle_expired') {
  return prisma.$transaction(async (tx) => {
    const state = await lockUser(tx, userId);
    const left = clamp0(state.subSeconds);
    if (left === 0) return { expired: 0 };

    await writeLedger(tx, {
      userId, kind: 'expiry', bucket: 'subscription', seconds: -left,
      perpetualAfter: state.balanceSeconds, subscriptionAfter: 0, note,
    });
    await tx.$executeRaw`
      UPDATE users SET sub_seconds = 0, sub_seconds_expires_at = NULL WHERE id = ${userId}
    `;
    return { expired: left };
  });
}

/* ------------------------------------------------------------------ *
 * The free trial
 * ------------------------------------------------------------------ */

const TRIAL_SALT = env.JWT_SECRET || 'iaa-trial-salt';

function claimHash(value) {
  return crypto.createHash('sha256').update(`${TRIAL_SALT}:${String(value)}`).digest('hex');
}

/**
 * The address a mailbox actually receives at, not the one that was typed.
 *
 * `me+1@gmail.com`, `me+2@gmail.com` and `m.e@gmail.com` are ONE mailbox, and
 * before this they were three free trials: registration verifies no email, so
 * the install-id claim was the only cross-account defence and it is a header
 * the client chooses. Plus-addressing is the zero-effort farm — a shell loop
 * with no app involved at all — and it is the one this closes. Sub-addressing
 * is a documented convention at every major provider, so dropping the tag is
 * not a guess about how the address is routed.
 *
 * Dot-insensitivity is Gmail-specific and is applied ONLY there; other domains
 * are free to treat `a.b@` and `ab@` as different people, and several do.
 */
export function canonicalEmail(email) {
  const raw = String(email ?? '').trim().toLowerCase();
  const at = raw.lastIndexOf('@');
  if (at <= 0 || at === raw.length - 1) return null;

  let local = raw.slice(0, at);
  const domain = raw.slice(at + 1);

  const plus = local.indexOf('+');
  if (plus === 0) return null;           // "+tag@" has no mailbox to speak of
  if (plus > 0) local = local.slice(0, plus);

  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
    return local ? `${local}@gmail.com` : null;
  }
  return `${local}@${domain}`;
}

/**
 * Grant the free trial, exactly once per account, lazily.
 *
 * Lazily — at the first /user/balance or /meeting/start rather than at
 * registration — for three reasons: the trial size stays tunable without a
 * backfill, dormant registrations do not sit on the books as a liability, and
 * the grant is attached to a request that carries the device header we claim
 * against. The user-visible effect is identical, because the home screen calls
 * /user/balance on mount.
 *
 * Four locks, deepest first:
 *   1. `users.trial_granted_at IS NULL` in the UPDATE's WHERE — one statement,
 *      so two taps of a double-tapped button grant ONE trial.
 *   2. `time_ledger.idempotency_key = 'trial:<id>'` — unique, so even a botched
 *      manual SQL fix or a restored backup cannot produce a second grant row.
 *   3. `trial_claims (install, <hash>)` — unique per install id.
 *   4. `trial_claims (email, <hash>)` — unique per MAILBOX, canonicalised.
 *
 * Claim 4 is the one that matters, because claim 3 is a header the client
 * chooses and is simply absent on a request that omits it. The cheap farm is
 * not "reinstall the app a thousand times", it is a shell loop over
 * me+1@gmail.com … me+1000@gmail.com that never touches the app at all;
 * canonicalEmail() collapses those onto one row and the unique index refuses
 * the second. Combined with registerLimiter (middleware/rateLimit.js), which
 * counts SUCCESSFUL registrations — authLimiter deliberately does not —
 * account creation is no longer free and unlimited.
 *
 * WHAT THIS STILL DOES NOT DO, stated plainly: a farmer with a thousand real
 * mailboxes, or a thousand IPs, still gets a thousand trials. Verified email
 * is the fix for that and does not exist yet. `free_trial_seconds = 0` remains
 * the kill switch and the daily trial_grant sum in the ledger remains the alarm.
 */
export async function ensureTrialGranted(userId, { installId } = {}) {
  const amount = CFG.trial();
  if (amount <= 0) return { granted: false, reason: 'trial_disabled' };

  const now = new Date();
  const hashed = installId ? claimHash(installId) : null;

  try {
    return await prisma.$transaction(async (tx) => {
      const state = await lockUser(tx, userId);
      if (state.trialGrantedAt) return { granted: false, reason: 'already_granted' };
      if (state.isDisabled) return { granted: false, reason: 'account_disabled' };

      if (hashed) {
        // Throws P2002 if this install already claimed a trial on another
        // account — caught below and reported, not crashed.
        await tx.trialClaim.create({
          data: { userId, claimType: 'install', claimHash: hashed },
        });
      }

      // Always available, unlike the install header, and not chosen by the
      // client: this is the address the account was created with.
      const owner = await tx.user.findUnique({
        where: { id: userId }, select: { email: true },
      });
      const mailbox = canonicalEmail(owner?.email);
      if (mailbox) {
        await tx.trialClaim.create({
          data: { userId, claimType: 'email', claimHash: claimHash(mailbox) },
        });
      }

      await writeLedger(tx, {
        userId, kind: 'trial_grant', bucket: 'perpetual', seconds: amount,
        perpetualAfter: state.balanceSeconds + amount,
        subscriptionAfter: state.subSeconds,
        idempotencyKey: `trial:${userId}`,
        note: 'free_trial',
      });

      // The check and the grant in one statement. `trial_granted_at IS NULL` is
      // the lock; a zero row count means someone else won and we roll back.
      const updated = await tx.$executeRaw`
        UPDATE users
           SET balance_seconds  = balance_seconds + ${amount},
               trial_seconds    = ${amount},
               trial_granted_at = ${now}
         WHERE id = ${userId}
           AND is_disabled = 0
           AND trial_granted_at IS NULL
      `;
      // Zero rows means another request won the race between the lock being
      // taken and this statement — roll the whole grant back rather than
      // leaving a ledger row with no seconds behind it.
      if (updated === 0) throw Object.assign(new Error('trial_race'), { trialRace: true });

      return { granted: true, seconds: amount };
    });
  } catch (err) {
    if (isDuplicateKey(err)) {
      const target = String(err.meta?.target ?? '');
      return {
        granted: false,
        reason: target.includes('trial_claims') || target.includes('claim')
          ? 'trial_already_claimed'
          : 'already_granted',
      };
    }
    if (err?.trialRace) return { granted: false, reason: 'already_granted' };
    throw err;
  }
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/**
 * The balance as the client renders it.
 *
 * `minutesRemaining` is floored, `remainingSeconds` is exact, and both are
 * returned: the home screen shows "٤٣ دقيقة" while the ledger page shows mm:ss,
 * so support can explain why 43 minutes and 43m51s are the same number.
 */
export async function balanceSnapshot(user, now = new Date()) {
  const validSub = validSubSeconds(user, now);
  const available = availableSeconds(user, now);
  const premium = hasPremium(user, now);
  return {
    balanceSeconds: clamp0(user.balanceSeconds),
    subSeconds: validSub,
    subExpiresAt: user.subSecondsExpiresAt ?? null,
    heldSeconds: clamp0(user.heldSeconds),
    availableSeconds: available,
    minutesRemaining: toMinutes(available),
    trialGranted: Boolean(user.trialGrantedAt),
    trialSeconds: clamp0(user.trialSeconds),
    plan: premium ? 'premium' : 'free',
    premiumUntil: user.premiumUntil ?? null,
    lowWaterSeconds: CFG.lowWater(),
  };
}

/** The statement. This is what makes "where did my minutes go?" self-service. */
export async function ledgerFor(userId, { limit = 50, before } = {}) {
  const rows = await prisma.timeLedgerEntry.findMany({
    where: { userId, ...(before ? { id: { lt: before } } : {}) },
    orderBy: { id: 'desc' },
    take: Math.min(200, Math.max(1, limit)),
    select: {
      id: true, kind: true, bucket: true, seconds: true,
      perpetualAfter: true, subscriptionAfter: true,
      meetingSessionId: true, paymentId: true, note: true, createdAt: true,
    },
  });
  return rows.map((r) => ({
    id: r.id.toString(),
    kind: r.kind,
    bucket: r.bucket,
    seconds: r.seconds,
    // Both are useful: the sign tells the user which way it went, the absolute
    // value is what they read.
    minutes: Math.floor(Math.abs(r.seconds) / 60),
    balanceAfterSeconds: r.perpetualAfter + r.subscriptionAfter,
    meetingSessionId: r.meetingSessionId ? r.meetingSessionId.toString() : null,
    paymentId: r.paymentId ? r.paymentId.toString() : null,
    note: r.note,
    createdAt: r.createdAt,
  }));
}

/** Load the balance columns without a lock, for read-only paths. */
export async function loadBalanceUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, plan: true, premiumUntil: true, isDisabled: true,
      balanceSeconds: true, subSeconds: true, subSecondsExpiresAt: true,
      heldSeconds: true, trialGrantedAt: true, trialSeconds: true,
    },
  });
  if (!user) throw new HttpError(404, 'User not found');
  return user;
}
