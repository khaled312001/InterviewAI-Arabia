/**
 * The meeting clock — the server-side record of how long an interview ran.
 *
 * THE PRINCIPLE: the server bills only wall-clock it has EVIDENCE for, and
 * evidence is a request the server received. No client-reported duration is
 * ever trusted, or even accepted. MeetingScreen keeps its own timer, but that
 * became a display driven by these numbers, never an input to them.
 *
 * Before this file there was nothing to meter against: /meeting/turn was
 * stateless and the `sessions` row was created at /finish, which even
 * fabricated `startedAt` as `Date.now() - history.length * 60_000`. A
 * `meeting_sessions` row now exists from the first second.
 *
 * THE MOST IMPORTANT RULE IN THE FILE, and the cheapest: a gap between
 * heartbeats longer than `meeting_max_gap_seconds` is billed at ZERO, not
 * clamped to the maximum. If no heartbeat arrived then no /turn arrived either,
 * so the interviewer was not speaking and we spent nothing at the model —
 * charging for that would be charging the user for our own silence. Those
 * seconds are recorded in `skipped_seconds` and shown to the user on their
 * receipt afterwards, which is the entire trust argument for billing by time,
 * made visible.
 *
 * THE RULE THAT KEEPS THAT ONE HONEST: it applies only to clients that promised
 * a heartbeat. A client that never promised one gives no evidence of silence by
 * failing to send one, and billing it at zero made a thirty-minute interview
 * cost fifteen turn floors. See billableGap().
 *
 * AND THE RULE THAT MAKES BOTH MEAN ANYTHING: one live meeting per user. A
 * meter that N clients can share is not a meter. See startMeeting().
 */

import { prisma } from '../../db/prisma.js';
import { logger } from '../../utils/logger.js';
import { HttpError } from '../../utils/asyncHandler.js';
import {
  CFG, lockUser, chargeLocked, refundLocked, availableSeconds, validSubSeconds,
  hasPremium, quotaError, toMinutes, ensureTrialGranted, notifyLowBalanceOnCrossing,
} from './minutes.js';
import { ensureCurrentCycle } from './cycles.js';

const clamp0 = (n) => Math.max(0, Math.trunc(Number(n) || 0));

/** Seconds between two instants, server clock only, never negative. */
function elapsed(from, to) {
  if (!from) return 0;
  const a = from instanceof Date ? from : new Date(from);
  return clamp0(Math.floor((to.getTime() - a.getTime()) / 1000));
}

/** A meeting opened by a client that sends no heartbeat. */
const isHeartbeatless = (meeting) => meeting?.client === 'legacy';

/**
 * How many of `delta` seconds this meeting may be billed for.
 *
 * TWO RULES, because there are two kinds of evidence.
 *
 * A HEARTBEATING client promised a tick every `meeting_tick_seconds`, so a gap
 * longer than `meeting_max_gap_seconds` means no tick arrived, which means no
 * /turn arrived either, which means the interviewer was not speaking and we
 * spent nothing at the model. Those seconds are billed at ZERO, not clamped —
 * charging for them is charging the user for our own silence.
 *
 * A HEARTBEATLESS client never promised anything, so "no heartbeat arrived" is
 * not evidence of silence and the zero rule cannot apply to it: applied anyway,
 * every inter-turn interval longer than 40 seconds became free and a genuine
 * thirty-minute interview cost fifteen turn floors — 450 seconds for 1800, a 4x
 * discount available by deleting one JSON key from the request body. What IS
 * evidence for those clients is the interval between two turns: the user was
 * answering, and the model call at the end of it happened. So it is billed,
 * capped at `meeting_turn_gap_seconds`, because a ten-minute pause between
 * exchanges is still not our cost.
 */
function billableGap(meeting, delta) {
  if (isHeartbeatless(meeting)) return Math.min(delta, CFG.turnGap());
  return delta <= CFG.maxGap() ? delta : 0;
}

/** How long a live meeting may go quiet before the sweeper settles it. */
function abandonWindow(meeting) {
  const base = CFG.abandonAfter();
  // A heartbeatless client only "speaks" once per exchange, so the ordinary
  // window would sweep it between two turns of a perfectly live interview —
  // and each swept meeting would be replaced by a fresh one that bills the
  // floor again, which is the very discount billableGap() just closed.
  return isHeartbeatless(meeting) ? base * 4 : base;
}

/* ------------------------------------------------------------------ *
 * Row access
 * ------------------------------------------------------------------ */

/**
 * LOCK ORDER, AND IT IS NOT NEGOTIABLE: the USER row first, then the meeting.
 *
 * Every path here takes both locks. /start naturally wants the user first (it
 * checks availability before it knows which meeting it will touch), while /tick
 * naturally wants the meeting first — and two transactions taking the same two
 * locks in opposite orders is the textbook deadlock. It would fire exactly when
 * a user opens a second interview while the first is still ticking, MySQL would
 * roll one side back, and the user would see a 500 mid-interview.
 *
 * So `lockMeeting` is only ever called AFTER `lockUser`, including in the
 * sweeper, which reads the owner id unlocked first in order to keep the order.
 */
async function lockMeeting(tx, meetingId) {
  const rows = await tx.$queryRaw`
    SELECT id, user_id AS userId, category_id AS categoryId, session_id AS sessionId,
           status, held_seconds AS heldSeconds, billed_seconds AS billedSeconds,
           skipped_seconds AS skippedSeconds, sub_seconds_used AS subSecondsUsed,
           perpetual_seconds_used AS perpetualSecondsUsed, turn_count AS turnCount,
           billed_at_last_turn AS billedAtLastTurn,
           started_at AS startedAt, last_tick_at AS lastTickAt,
           ended_at AS endedAt, end_reason AS endReason, client
      FROM meeting_sessions
     WHERE id = ${meetingId}
     FOR UPDATE
  `;
  const m = rows?.[0];
  if (!m) return null;
  return {
    id: m.id,
    userId: m.userId,
    categoryId: Number(m.categoryId),
    sessionId: m.sessionId,
    status: m.status,
    client: m.client,
    heldSeconds: clamp0(m.heldSeconds),
    billedSeconds: clamp0(m.billedSeconds),
    skippedSeconds: clamp0(m.skippedSeconds),
    subSecondsUsed: clamp0(m.subSecondsUsed),
    perpetualSecondsUsed: clamp0(m.perpetualSecondsUsed),
    turnCount: clamp0(m.turnCount),
    billedAtLastTurn: clamp0(m.billedAtLastTurn),
    startedAt: m.startedAt,
    lastTickAt: m.lastTickAt,
    endedAt: m.endedAt,
    endReason: m.endReason,
  };
}

/** Seconds accrued but not yet moved out of the hold and onto the ledger. */
function unsettled(meeting) {
  return Math.max(0, meeting.billedSeconds - (meeting.subSecondsUsed + meeting.perpetualSecondsUsed));
}

export function meetingExpired() {
  return new HttpError(
    409,
    'انتهت هذه الجلسة؛ ابدأ مقابلة جديدة / This meeting has ended, start a new one',
    undefined,
    'MEETING_EXPIRED',
  );
}

/* ------------------------------------------------------------------ *
 * Settlement
 * ------------------------------------------------------------------ */

/**
 * Move accrued seconds out of the reservation and onto the ledger.
 *
 * Called at most a handful of times per interview — when the hold runs low, and
 * once at the end — never on every tick. One interview should be ONE line on
 * the user's statement that a support agent can point at, not forty.
 *
 * Idempotency comes from the meeting row itself, under the same lock: settling
 * sets `*_seconds_used` so `unsettled()` drops to zero, and a retry therefore
 * finds nothing to charge. The ledger's idempotency key is a second belt.
 */
async function settleLocked(tx, state, meeting, { now, releaseAll = false }) {
  const due = unsettled(meeting);
  const release = releaseAll ? meeting.heldSeconds : Math.min(meeting.heldSeconds, due);

  if (due === 0) {
    if (release > 0) {
      await tx.$executeRaw`
        UPDATE users SET held_seconds = GREATEST(0, held_seconds - ${release}) WHERE id = ${state.id}
      `;
      meeting.heldSeconds -= release;
      state = { ...state, heldSeconds: Math.max(0, state.heldSeconds - release) };
    }
    return { state, meeting, charged: 0 };
  }

  const receipt = await chargeLocked(tx, state, due, {
    now,
    releaseHold: release,
    kind: 'consumption',
    meetingSessionId: meeting.id,
    // Keyed on how much this meeting has ALREADY settled, not on what it has
    // accrued. That number only ever moves forward on a committed settlement,
    // so a genuine retry (the transaction rolled back, nothing was settled)
    // recomputes the same key and is refused, while a later settlement gets a
    // new one. Keying on `billed_seconds` instead would collide whenever a
    // partial settlement was followed by a second attempt at the same total —
    // which is exactly what happens after a goodwill overdraft is topped up.
    idempotencyKey: `meeting:${meeting.id}:settle:${meeting.subSecondsUsed + meeting.perpetualSecondsUsed}`,
    note: `interview #${meeting.id}`,
  });

  meeting.subSecondsUsed += receipt.subUsed;
  meeting.perpetualSecondsUsed += receipt.perpUsed;
  meeting.heldSeconds = Math.max(0, meeting.heldSeconds - release);

  // `charged < due` means the balance ran out mid-settlement: the deliberate
  // goodwill overdraft on a closing turn. The ledger records what was actually
  // taken, so reconciliation still balances.
  if (receipt.shortfall > 0) {
    logger.info('meeting settled short (goodwill overdraft)', {
      meetingId: String(meeting.id), due, charged: receipt.charged,
    });
  }

  return { state: receipt.state, meeting, charged: receipt.charged };
}

/**
 * Top the reservation back up to a full window, taking only what is available.
 *
 * Under the user row lock, so computing the amount and taking it cannot race.
 */
async function topUpHoldLocked(tx, state, meeting, now) {
  const target = CFG.holdWindow();
  const live = meeting.heldSeconds - unsettled(meeting);
  const want = Math.max(0, target - Math.max(0, live));
  if (want === 0) return { state, meeting, added: 0 };

  const take = Math.min(want, availableSeconds(state, now));
  if (take === 0) return { state, meeting, added: 0 };

  await tx.$executeRaw`
    UPDATE users SET held_seconds = held_seconds + ${take} WHERE id = ${state.id}
  `;
  return {
    state: { ...state, heldSeconds: state.heldSeconds + take },
    meeting: Object.assign(meeting, { heldSeconds: meeting.heldSeconds + take }),
    added: take,
  };
}

/**
 * Everything the user can still spend IN THIS MEETING: both buckets, minus the
 * reservations of any *other* live meeting, minus what this meeting has accrued
 * and not yet paid for. Holds are not spends, so this meeting's own reservation
 * is not subtracted twice.
 *
 * Split out of billingView() rather than inlined twice, because the low-balance
 * edge below compares this number from before the accrual against the one
 * after it, and an edge computed from two subtly different formulas fires on
 * crossings that never happened.
 *
 * DELIBERATELY INVARIANT ACROSS SETTLEMENT: settling moves seconds out of the
 * buckets and releases the same number from the hold, so `spendable` and
 * `unsettled` fall together and this total does not move. Only ACCRUAL moves
 * it — which is what makes it the right quantity to detect a crossing on, and
 * `availableSeconds()` the wrong one: that number barely twitches when a
 * meeting settles, so an edge built on it would never fire mid-interview.
 */
function remainingFor(state, meeting, now) {
  const othersHeld = Math.max(0, state.heldSeconds - meeting.heldSeconds);
  const spendable = validSubSeconds(state, now) + clamp0(state.balanceSeconds);
  return Math.max(0, spendable - othersHeld - unsettled(meeting));
}

/**
 * What the client is told after every tick and turn.
 */
function billingView(state, meeting, now, extra = {}) {
  const remaining = remainingFor(state, meeting, now);
  const lowWater = CFG.lowWater();
  return {
    meetingId: meeting.id.toString(),
    remainingSeconds: remaining,
    remainingMinutes: toMinutes(remaining),
    billedSeconds: meeting.billedSeconds,
    skippedSeconds: meeting.skippedSeconds,
    tickSeconds: CFG.tick(),
    lowWaterSeconds: lowWater,
    warn: remaining > 0 && remaining <= lowWater,
    exhausted: remaining <= 0,
    ...extra,
  };
}

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */

/**
 * Open (or resume) the billing clock for an interview.
 *
 * ONE LIVE MEETING PER USER. This is the rule that makes the meter a meter.
 *
 * The previous version resumed ANY live meeting the user had, bound to nothing
 * — not a device, not a session, not even the requested category. Two clients
 * on one account therefore received the SAME meeting id, and because
 * advanceMeeting() bills `elapsed(lastTickAt, now)` and then stamps
 * `last_tick_at = now`, N interleaved heartbeats accrued ONE wall-clock between
 * them. Five browser tabs ran five simultaneous interviews and the meter
 * charged for one: 3000 seconds of model time against 600 seconds of balance,
 * and the same multiplier applied to every purchased pack.
 *
 * RESUME NOW REQUIRES THE CLIENT TO PRESENT THE ID IT WAS GIVEN. That is the
 * only signal that actually distinguishes "the app I already had open" from "a
 * second copy of the app": a device fingerprint does not, because two tabs of
 * /app share one install id. An app that was killed and reopened still resumes,
 * because it still holds its meeting id. Anything else the user has open is a
 * SECOND concurrent interview and is ended — settled honestly for what it used,
 * its reservation released — before the new one opens. The superseded client's
 * next tick gets a 409 and closes into its evaluation, which is a path it
 * already handles because the sweeper produces the same outcome.
 */
export async function startMeeting({ userId, categoryId, client, installId, resumeMeetingId = null }) {
  const now = new Date();

  // Lazily grants the ten free minutes on first use. Idempotent, and outside
  // the transaction below so a trial race cannot roll the meeting back.
  await ensureTrialGranted(userId, { installId });

  // Self-heal before checking availability: if the in-process scheduler was
  // lost to a Passenger recycle, this user's own stale holds are released here
  // rather than stranding minutes they cannot spend until someone notices.
  await sweepUserMeetings(userId, now);

  // A subscriber whose cycle rolled over minutes ago must not be told to buy
  // minutes because the hourly job has not run yet.
  await ensureCurrentCycle(userId, now);

  // Resolve concurrency BEFORE the transaction: endMeeting() takes its own, and
  // nesting one inside another would hold the user row lock across it.
  const liveRows = await prisma.$queryRaw`
    SELECT id, client, last_tick_at AS lastTickAt
      FROM meeting_sessions
     WHERE user_id = ${userId} AND status = 'live'
     ORDER BY started_at DESC
     LIMIT 20
  `;

  let resumeId = null;
  for (const row of liveRows ?? []) {
    const presented = resumeMeetingId != null && String(row.id) === String(resumeMeetingId);
    const fresh = elapsed(row.lastTickAt, now) <= abandonWindow(row);
    if (presented && resumeId === null && fresh) {
      resumeId = row.id;
      continue;
    }
    // Not the meeting this client is holding: a second interview on the same
    // account. Settle it for what it actually used and give the hold back.
    await endMeeting(row.id, userId, { reason: 'superseded', now });
  }

  return prisma.$transaction(async (tx) => {
    const state0 = await lockUser(tx, userId);
    if (state0.isDisabled) {
      throw new HttpError(403, 'هذا الحساب موقوف / This account is suspended', undefined, 'ACCOUNT_DISABLED');
    }

    if (resumeId !== null) {
      const existing = await lockMeeting(tx, resumeId);
      if (existing && existing.status === 'live') {
        return {
          resumed: true,
          meeting: existing,
          billing: billingView(state0, existing, now, { resumed: true }),
        };
      }
    }

    const minStart = CFG.minStart();
    const available = availableSeconds(state0, now);
    // Refuse rather than open an interview that dies in eight seconds. A call
    // that never starts is a worse experience than one that ends badly, but
    // only by a little — and this one is honest about why.
    if (available < minStart) {
      throw quotaError({
        balanceSeconds: available,
        requiredSeconds: minStart,
        trialUsed: Boolean(state0.trialGrantedAt),
      });
    }

    const reserve = Math.min(CFG.holdWindow(), available);
    await tx.$executeRaw`
      UPDATE users SET held_seconds = held_seconds + ${reserve} WHERE id = ${userId}
    `;
    const state = { ...state0, heldSeconds: state0.heldSeconds + reserve };

    const created = await tx.meetingSession.create({
      data: {
        userId,
        categoryId,
        status: 'live',
        heldSeconds: reserve,
        startedAt: now,
        lastTickAt: now,
        client: client ? String(client).slice(0, 32) : null,
      },
      select: { id: true, startedAt: true, lastTickAt: true },
    });

    const meeting = {
      id: created.id, userId, categoryId, sessionId: null, status: 'live',
      client: client ? String(client).slice(0, 32) : null,
      heldSeconds: reserve, billedSeconds: 0, skippedSeconds: 0,
      subSecondsUsed: 0, perpetualSecondsUsed: 0, turnCount: 0, billedAtLastTurn: 0,
      startedAt: created.startedAt, lastTickAt: created.lastTickAt,
      endedAt: null, endReason: null,
    };

    return { resumed: false, meeting, billing: billingView(state, meeting, now, { resumed: false }) };
  });
}

/* ------------------------------------------------------------------ *
 * Tick / turn accrual
 * ------------------------------------------------------------------ */

/**
 * Advance the clock: charge the wall-clock since the last heartbeat, apply the
 * turn floor when this is a turn, settle if the reservation is running out.
 *
 * THE TURN FLOOR closes one specific exploit: stop sending heartbeats, call
 * /turn every two minutes, and every interval is a >max-gap window billed at
 * zero — a free thirty-minute interview. With the floor, a turn costs at least
 * `meeting_min_turn_seconds`.
 *
 * It is a TOP-UP measured against the seconds accrued since the PREVIOUS TURN,
 * not since the previous tick, which is why `billed_at_last_turn` exists. For a
 * client that is ticking normally, a real exchange has already accrued more
 * than the floor, the top-up computes to zero, and the floor never binds. It
 * bites only the client that stopped ticking — exactly the client it is for.
 *
 * IT IS ALSO THE BOUND ON CONCURRENT TURNS, which is why subscribers are no
 * longer exempt from it outright. One live meeting per user stops two clients
 * being handed two meetings; it does not stop two clients POSTing two turns
 * against the SAME meeting in the same second, and wall-clock alone bills those
 * two model calls as one second. A turn that can cost nothing is a turn that
 * can be issued in parallel for nothing.
 *
 * A subscriber's floor is therefore the TICK interval rather than the full
 * `meeting_min_turn_seconds`: below one heartbeat is not a real exchange (the
 * interviewer's own reply takes longer than that to generate and speak), so it
 * never binds on an honest interview, and pure wall-clock billing survives for
 * every exchange that actually happened. Both numbers are app_settings rows; an
 * operator who disagrees can set `meeting_min_turn_seconds` to 0.
 */
export async function advanceMeeting(meetingId, userId, {
  isTurn = false, now = new Date(),
} = {}) {
  // Recorded under the lock, acted on only after the commit — a push must not
  // be awaited inside a transaction, and a push for an accrual that then rolled
  // back is a lie. See notifyLowBalanceOnCrossing() in minutes.js.
  let crossing = null;

  const out = await prisma.$transaction(async (tx) => {
    // User first, then meeting. See the note on lockMeeting().
    let state = await lockUser(tx, userId);

    const meeting = await lockMeeting(tx, meetingId);
    if (!meeting || String(meeting.userId) !== String(userId)) throw meetingExpired();
    if (meeting.status !== 'live') throw meetingExpired();

    const premium = hasPremium(state, now);

    // Read BEFORE the accrual below moves it: this is the "was above" half of
    // the low-balance edge, and it has to come off the same locked rows the
    // "now below" half is computed from.
    const remainingBefore = remainingFor(state, meeting, now);

    const delta = elapsed(meeting.lastTickAt, now);
    const chargeable = billableGap(meeting, delta);
    const skipped = delta - chargeable;

    meeting.billedSeconds += chargeable;
    meeting.skippedSeconds += skipped;

    let floorTopUp = 0;
    if (isTurn) {
      const sinceLastTurn = meeting.billedSeconds - meeting.billedAtLastTurn;
      // A subscriber pays wall-clock, floored at one heartbeat: enough that two
      // turns in the same second cannot both be free, never enough to reach a
      // real exchange. Everyone else pays the full turn floor.
      const floor = premium ? Math.min(CFG.minTurn(), CFG.tick()) : CFG.minTurn();
      floorTopUp = Math.max(0, floor - sinceLastTurn);
      meeting.billedSeconds += floorTopUp;
      if (floorTopUp > 0) {
        // Instrument it: if this fires for real users on real networks, the
        // floor is too high or the tick interval too long.
        logger.info('turn floor applied', {
          meetingId: String(meeting.id), floorTopUp, sinceLastTurn, premium,
        });
      }
    }
    if (isTurn) {
      meeting.turnCount += 1;
      meeting.billedAtLastTurn = meeting.billedSeconds;
    }

    // Settle only when the reservation is nearly consumed. Ticks accrue on the
    // meeting row; they do not each write a ledger row, or one interview would
    // produce forty of them and make the user's statement unreadable.
    //
    // The `tick * 2` floor on the threshold matters for a nearly-empty balance:
    // there the whole reservation may be smaller than the low-water mark, and a
    // bare `held - unsettled <= lowWater` test would settle on every single
    // tick — a ledger row every fifteen seconds for precisely the user least
    // able to make sense of their statement.
    const settleAt = Math.max(CFG.tick() * 2, meeting.heldSeconds - CFG.lowWater());
    if (unsettled(meeting) >= settleAt) {
      ({ state } = await settleLocked(tx, state, meeting, { now }));
      ({ state } = await topUpHoldLocked(tx, state, meeting, now));
    }

    await tx.$executeRaw`
      UPDATE meeting_sessions
         SET billed_seconds       = ${meeting.billedSeconds},
             skipped_seconds      = ${meeting.skippedSeconds},
             sub_seconds_used     = ${meeting.subSecondsUsed},
             perpetual_seconds_used = ${meeting.perpetualSecondsUsed},
             held_seconds         = ${meeting.heldSeconds},
             turn_count           = ${meeting.turnCount},
             billed_at_last_turn  = ${meeting.billedAtLastTurn},
             last_tick_at         = ${now}
       WHERE id = ${meeting.id}
    `;

    const billing = billingView(state, meeting, now, {
      floorTopUp,
      skippedThisTick: skipped,
      premium,
    });

    crossing = { before: remainingBefore, after: billing.remainingSeconds };

    // Mark the closing turn. The NEXT /turn refuses — this one is granted, and
    // is allowed to overdraft by up to the turn floor. Thirty seconds of
    // goodwill costs about half an Egyptian pound and buys a closing sentence
    // instead of a dead line; never let a user's last memory of the product be
    // a spinner.
    if (isTurn && billing.exhausted && meeting.endReason !== 'exhausted') {
      await tx.$executeRaw`
        UPDATE meeting_sessions SET end_reason = 'exhausted' WHERE id = ${meeting.id}
      `;
      meeting.endReason = 'exhausted';
    }

    return { meeting, billing, state };
  });

  if (crossing) notifyLowBalanceOnCrossing(userId, crossing.before, crossing.after);
  return out;
}

/**
 * True when this meeting already served its goodwill closing turn, or is
 * simply no longer live. The client that keeps calling after that gets the 402.
 *
 * `status` is checked as well as `end_reason`, and that is not belt-and-braces:
 * the sweeper re-stamps `end_reason` to 'abandoned' when a heartbeat goes
 * stale, so `end_reason === 'exhausted'` alone was a flag that erased itself
 * two minutes later. The route ends an exhausted meeting immediately for the
 * same reason — a terminal status is the durable fact.
 */
export function alreadyClosed(meeting) {
  return meeting?.endReason === 'exhausted' || meeting?.status === 'exhausted';
}

/* ------------------------------------------------------------------ *
 * End
 * ------------------------------------------------------------------ */

/**
 * Final settlement. Charges everything outstanding, releases the whole
 * reservation, and stamps the terminal status.
 *
 * Safe to call twice: a meeting that is not `live` settles nothing and returns
 * its stored numbers, so /finish after the sweeper already abandoned the
 * meeting still produces a correct receipt.
 */
export async function endMeeting(meetingId, userId, { reason = 'user_ended', sessionId = null, now = new Date() } = {}) {
  // The owner, read WITHOUT a lock, purely so the user row can be locked before
  // the meeting row. `user_id` never changes, so this read cannot go stale in a
  // way that matters, and the ownership check below is repeated under the lock.
  const owner = userId ?? (await prisma.meetingSession.findUnique({
    where: { id: meetingId }, select: { userId: true },
  }))?.userId;
  if (!owner) return null;

  // As in advanceMeeting(): recorded under the lock, sent after the commit.
  let crossing = null;

  const out = await prisma.$transaction(async (tx) => {
    let state = await lockUser(tx, owner);

    const meeting = await lockMeeting(tx, meetingId);
    if (!meeting) return null;
    if (String(meeting.userId) !== String(owner)) return null;

    // Only the live branch bills anything, so only it can cross the mark.
    let remainingBefore = null;

    if (meeting.status === 'live') {
      remainingBefore = remainingFor(state, meeting, now);

      // Bill the final partial interval under the same gap rule, so an app
      // that was closed cleanly is charged for the seconds it actually used.
      const delta = elapsed(meeting.lastTickAt, now);
      const chargeable = billableGap(meeting, delta);
      meeting.billedSeconds += chargeable;
      meeting.skippedSeconds += delta - chargeable;

      ({ state } = await settleLocked(tx, state, meeting, { now, releaseAll: true }));

      // EXHAUSTION SURVIVES EVERY OTHER REASON. The sweeper closes a stale
      // meeting as 'abandoned', and when that overwrote an 'exhausted' flag the
      // paywall on /turn silently reopened. A meeting that ran out of minutes
      // ran out of minutes, whatever ends it afterwards.
      reason = meeting.endReason === 'exhausted' ? 'exhausted' : reason;

      const status = reason === 'exhausted' ? 'exhausted'
        : reason === 'abandoned' ? 'abandoned'
        : 'ended';

      await tx.$executeRaw`
        UPDATE meeting_sessions
           SET status                 = ${status},
               billed_seconds         = ${meeting.billedSeconds},
               skipped_seconds        = ${meeting.skippedSeconds},
               sub_seconds_used       = ${meeting.subSecondsUsed},
               perpetual_seconds_used = ${meeting.perpetualSecondsUsed},
               held_seconds           = 0,
               ended_at               = ${now},
               end_reason             = ${reason},
               session_id             = COALESCE(${sessionId}, session_id)
         WHERE id = ${meeting.id}
      `;
      meeting.status = status;
      meeting.heldSeconds = 0;
      meeting.endedAt = now;
      meeting.endReason = reason;
    } else if (sessionId) {
      await tx.$executeRaw`
        UPDATE meeting_sessions SET session_id = ${sessionId} WHERE id = ${meeting.id}
      `;
      meeting.sessionId = sessionId;
    }

    const billing = billingView(state, meeting, now);
    if (remainingBefore !== null) {
      crossing = { before: remainingBefore, after: billing.remainingSeconds };
    }
    return { meeting, billing, state };
  });

  // The sweeper reaches this for many users at once, and that is not a blast:
  // the edge is per user and per descent, so a sweep of two hundred abandoned
  // meetings notifies only the handful that actually ran their balance down.
  if (crossing) notifyLowBalanceOnCrossing(owner, crossing.before, crossing.after);
  return out;
}

/* ------------------------------------------------------------------ *
 * Legacy clients
 * ------------------------------------------------------------------ */

/**
 * Which meeting a /turn belongs to when the client sent no `meetingId`.
 *
 * Old builds are in the field — an installed Play release and a cached static
 * bundle at /app — and an interview in progress when the new backend goes live
 * sends no meeting id either. Rejecting those would break every interview at
 * deploy time and every un-updated install thereafter. So the path stays, with
 * two changes that turn it from a hole back into a transition allowance:
 *
 * 1. IT BINDS TO THE USER'S LIVE MEETING FIRST, whatever opened it. A modern
 *    client that dropped the field — by accident, or by one line in a proxy —
 *    lands back on the metered meeting its own /start opened, heartbeats and
 *    all. Previously it landed on a hold-less legacy row instead, and a genuine
 *    thirty-minute interview billed 450 seconds. There is now no cheaper way to
 *    hold a conversation than the honest one.
 *
 * 2. A NEW MEETING GOES THROUGH startMeeting(), which means the balance check,
 *    the minimum, the reservation and the trial grant all apply. The old
 *    implicit row had none of them: it opened with `end_reason` NULL and no
 *    hold, so an account with a zero balance could open one, take its goodwill
 *    turn, wait for the sweeper, and open another — an unlimited free interview,
 *    one exchange at a time, forever.
 */
export async function resolveTurnMeeting({ userId, categoryId, installId = null, now = new Date() }) {
  const live = await prisma.$queryRaw`
    SELECT id, client, last_tick_at AS lastTickAt
      FROM meeting_sessions
     WHERE user_id = ${userId} AND status = 'live'
     ORDER BY started_at DESC LIMIT 1
  `;
  const found = live?.[0];
  if (found && elapsed(found.lastTickAt, now) <= abandonWindow(found)) return found.id;

  logger.info('implicit meeting opened for legacy client', { userId: String(userId) });
  const { meeting } = await startMeeting({
    userId, categoryId, client: 'legacy', installId,
  });
  return meeting.id;
}

/**
 * Undo a turn floor whose model call then failed.
 *
 * The rule this keeps is the one /prepare and /sessions/:id/answer keep through
 * refundFlat(): a model call that FAILED costs the user nothing. Only the FLOOR
 * is reversed — the wall-clock ticked before it is time the user genuinely
 * spent waiting in the interview.
 *
 * IT HAS TO BE ABLE TO GIVE MONEY BACK, which is why this is a transaction and
 * not the bare `UPDATE meeting_sessions SET billed_seconds = billed_seconds - n`
 * it replaces. advanceMeeting() may have SETTLED that same floor moments
 * earlier in the same request; `unsettled()` is `max(0, billed - used)`, so
 * lowering `billed` under `used` clamped to zero and the seconds stayed
 * deducted. The user was charged half a minute for "the interviewer is
 * temporarily unavailable", no refund row was written, and reconciliation could
 * not see it because the counters still agreed with the ledger.
 *
 * Best-effort by contract: a failed reversal must not turn a 503 into a 500.
 */
export async function reverseTurnFloor(meetingId, userId, floorTopUp) {
  const want = clamp0(floorTopUp);
  if (want === 0) return { reversed: 0, refunded: 0 };

  try {
    return await prisma.$transaction(async (tx) => {
      // User first, then meeting. See the note on lockMeeting().
      let state = await lockUser(tx, userId);
      const meeting = await lockMeeting(tx, meetingId);
      if (!meeting || String(meeting.userId) !== String(userId) || meeting.status !== 'live') {
        return { reversed: 0, refunded: 0 };
      }

      const take = Math.min(want, meeting.billedSeconds);
      if (take === 0) return { reversed: 0, refunded: 0 };

      const newBilled = meeting.billedSeconds - take;
      const used = meeting.subSecondsUsed + meeting.perpetualSecondsUsed;

      let subBack = 0;
      let perpBack = 0;
      if (newBilled < used) {
        // Already settled. Return it to the buckets it came from, PERPETUAL
        // first: a charge spends the perishable subscription seconds first, so
        // the last seconds taken are the permanent ones and they are the first
        // ones owed back.
        const over = used - newBilled;
        perpBack = Math.min(over, meeting.perpetualSecondsUsed);
        subBack = Math.min(over - perpBack, meeting.subSecondsUsed);
        state = await refundLocked(tx, state, { subUsed: subBack, perpUsed: perpBack }, {
          note: 'turn_floor_reversed',
          meetingSessionId: meeting.id,
        });
      }

      await tx.$executeRaw`
        UPDATE meeting_sessions
           SET billed_seconds         = ${newBilled},
               billed_at_last_turn    = ${Math.max(0, meeting.billedAtLastTurn - take)},
               sub_seconds_used       = ${meeting.subSecondsUsed - subBack},
               perpetual_seconds_used = ${meeting.perpetualSecondsUsed - perpBack}
         WHERE id = ${meeting.id}
      `;

      return { reversed: take, refunded: subBack + perpBack };
    });
  } catch (err) {
    logger.error('turn floor reversal failed', {
      meetingId: String(meetingId), message: err.message,
    });
    return { reversed: 0, refunded: 0 };
  }
}

/* ------------------------------------------------------------------ *
 * Sweeping
 * ------------------------------------------------------------------ */

/**
 * Settle and close live meetings whose heartbeat went stale.
 *
 * This is the job that guarantees a killed app cannot hold minutes hostage.
 * The user is charged only for the seconds that ticked before the app died,
 * plus at most one sub-max-gap interval.
 */
export async function sweepAbandonedMeetings(now = new Date(), { userId = null, limit = 200 } = {}) {
  const cutoff = new Date(now.getTime() - CFG.abandonAfter() * 1000);
  // A heartbeatless client speaks once per exchange, not four times a minute,
  // so the ordinary window would sweep it mid-interview — and each replacement
  // meeting would start its billing from zero. See abandonWindow().
  const legacyCutoff = new Date(now.getTime() - CFG.abandonAfter() * 4 * 1000);
  //
  // Written as "past the ordinary cutoff, AND past the legacy cutoff if it is a
  // legacy row" rather than as an IF() on the right-hand side, so the range scan
  // on the (status, last_tick_at) index still applies and the client test is
  // only a filter on the rows it returns.
  const rows = userId
    ? await prisma.$queryRaw`
        SELECT id FROM meeting_sessions
         WHERE status = 'live' AND user_id = ${userId}
           AND last_tick_at < ${cutoff}
           AND (client IS NULL OR client <> 'legacy' OR last_tick_at < ${legacyCutoff})
         LIMIT ${limit}`
    : await prisma.$queryRaw`
        SELECT id FROM meeting_sessions
         WHERE status = 'live'
           AND last_tick_at < ${cutoff}
           AND (client IS NULL OR client <> 'legacy' OR last_tick_at < ${legacyCutoff})
         LIMIT ${limit}`;

  let swept = 0;
  let charged = 0;
  for (const row of rows ?? []) {
    try {
      const out = await endMeeting(row.id, null, { reason: 'abandoned', now });
      if (out) { swept += 1; charged += out.meeting.billedSeconds; }
    } catch (err) {
      logger.error('meeting sweep failed', { meetingId: String(row.id), message: err.message });
    }
  }
  return { meetingsAbandoned: swept, secondsSettled: charged };
}

/** The self-heal called at /meeting/start, scoped to one user. */
export async function sweepUserMeetings(userId, now = new Date()) {
  return sweepAbandonedMeetings(now, { userId, limit: 20 });
}

/**
 * The most recent meeting to attach an evaluation to when the client sent no
 * meeting id. Returns null rather than throwing when there is nothing to
 * attach — /finish decides what to do about that, and it is the only caller.
 *
 * 'ended' is included: a client that posts /end before /finish (the mobile app
 * does, if the screen unmounts first) would otherwise present no meeting at
 * all, and /finish now REQUIRES one.
 */
export async function latestMeetingFor(userId) {
  const rows = await prisma.$queryRaw`
    SELECT id FROM meeting_sessions
     WHERE user_id = ${userId} AND status IN ('live','ended','abandoned','exhausted')
     ORDER BY started_at DESC LIMIT 1
  `;
  return rows?.[0]?.id ?? null;
}

/** Read a meeting for a response body, without a lock. */
export async function readMeeting(meetingId, userId) {
  const meeting = await prisma.meetingSession.findUnique({ where: { id: meetingId } });
  if (!meeting || String(meeting.userId) !== String(userId)) return null;
  return meeting;
}
