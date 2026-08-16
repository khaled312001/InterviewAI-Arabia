import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { prisma } from '../db/prisma.js';
import { query, queryOne } from '../db/mysql.js';
import { requireUser } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import {
  balanceSnapshot, loadBalanceUser, ledgerFor, ensureTrialGranted, CFG,
} from '../services/billing/minutes.js';
import { ensureCurrentCycle } from '../services/billing/cycles.js';

const router = Router();

const updateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  language: z.enum(['ar', 'en']).optional(),
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(8).max(200).optional(),
});

function toPublicUser(u) {
  return {
    id: u.id.toString(),
    email: u.email,
    name: u.name,
    language: u.language,
    plan: u.plan,
    premiumUntil: u.premiumUntil ?? null,
    // The balance, in both units: seconds are exact and drive the client's
    // countdown, minutes are floored for display. Floored, never rounded —
    // overstating produces "it said 5 minutes and cut me off at 4".
    balanceSeconds: u.balanceSeconds ?? 0,
    minutesRemaining: Math.floor(Math.max(0, u.balanceSeconds ?? 0) / 60),
    // DEPRECATED, still emitted for one release so an old client that reads
    // them keeps rendering. Nothing writes them any more.
    dailyQuestionsUsed: u.dailyQuestionsUsed,
    lastResetDate: u.lastResetDate,
    createdAt: u.createdAt,
  };
}

router.get('/me', requireUser, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new HttpError(404, 'User not found');
  res.json({ user: toPublicUser(user) });
}));

router.patch('/me', requireUser, asyncHandler(async (req, res) => {
  const body = updateSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new HttpError(404, 'User not found');

  const data = {};
  if (body.name) data.name = body.name;
  if (body.language) data.language = body.language;

  if (body.newPassword) {
    if (!body.currentPassword) throw new HttpError(400, 'currentPassword is required to change password');
    const ok = await bcrypt.compare(body.currentPassword, user.passwordHash);
    if (!ok) throw new HttpError(401, 'كلمة المرور الحالية غير صحيحة / Current password incorrect');
    data.passwordHash = await bcrypt.hash(body.newPassword, 12);
  }

  const updated = await prisma.user.update({ where: { id: req.userId }, data });
  res.json({ user: toPublicUser(updated) });
}));

/* -------------------------------------------------------------------------
 * DELETE /api/user/me
 *
 * Google Play requires an in-app deletion path for any app with accounts, and
 * a matching web URL (landing/delete-account.html).
 *
 * This ERASES rather than DROPS the row, and the distinction is deliberate.
 * `Payment` has `onDelete: Cascade` on its user relation, so deleting the row
 * would take the payment ledger with it — records we are obliged to keep for
 * Egyptian bookkeeping, and which the published privacy policy states are
 * retained. So: every piece of personal data is destroyed and the account is
 * made permanently unusable, while the financial rows keep a foreign key to an
 * anonymous shell. That is what the policy promises, exactly.
 *
 * Sessions, answers, refresh tokens and reset tokens are deleted outright —
 * they cascade from the ids below and hold the candidate's own words.
 * ---------------------------------------------------------------------- */

const deleteSchema = z.object({
  // A stolen session token must not be enough to destroy someone's account.
  password: z.string().min(1),
});

router.delete('/me', requireUser, asyncHandler(async (req, res) => {
  const { password } = deleteSchema.parse(req.body ?? {});

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new HttpError(404, 'User not found');

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new HttpError(401, 'كلمة المرور غير صحيحة / Password incorrect', undefined, 'BAD_PASSWORD');

  const id = req.userId;
  // A hash of a value nobody holds: the account can never be signed into again,
  // and the column stays non-null as the schema requires.
  const deadHash = await bcrypt.hash(`deleted:${id}:${crypto.randomUUID()}`, 12);

  await prisma.$transaction([
    prisma.session.deleteMany({ where: { userId: id } }),   // cascades to answers
    prisma.refreshToken.deleteMany({ where: { userId: id } }),
    prisma.passwordReset.deleteMany({ where: { userId: id } }),
    // CANCEL THE SUBSCRIPTION, don't just clear the mirror.
    //
    // services/maintenance.js:reconcilePremiumMirror() derives plan and
    // premium_until FROM the subscription rows — deliberately, because the
    // mirror is the entitlement and the rows are the ledger that explains it.
    // Clearing the mirror while leaving an active row with a future expiry was
    // therefore not a deletion but a race: within the hour the reconcile job
    // wrote plan='premium' back onto the tombstone, and for the rest of the
    // term the deleted account counted as a premium user in analytics, showed
    // up in the admin's premium filter, and kept being credited cycle minutes.
    // Cancelling is also the only thing that tells the operator a paying
    // customer churned. The row itself survives: it is the explanation for
    // money already taken, which is exactly what the rest of this handler is
    // careful to keep.
    prisma.subscription.updateMany({
      where: { userId: id, status: { in: ['active', 'pending'] } },
      data: { status: 'cancelled', cancelledAt: new Date(), autoRenew: false },
    }),
    prisma.user.update({
      where: { id },
      data: {
        // Unique constraint still applies, so the tombstone has to be unique too.
        email: `deleted-${id}@deleted.thiqty.app`,
        name: 'حساب محذوف',
        phone: null,
        passwordHash: deadHash,
        isDisabled: true,
        plan: 'free',
        premiumUntil: null,
        dailyQuestionsUsed: 0,
      },
    }),
  ]);

  res.json({ deleted: true });
}));

/* -------------------------------------------------------------------------
 * GET /api/user/balance — "you have 43 minutes left"
 *
 * Also the FIRST place the free trial is granted, because the home screen calls
 * this on mount. Granting lazily here rather than at registration keeps the
 * trial size tunable without a backfill, keeps dormant registrations off the
 * books as a liability, and attaches the grant to a request that carries the
 * install header we claim against. The user-visible effect is identical: a new
 * account sees "رصيدك: ١٠ دقائق" before it taps anything.
 * ---------------------------------------------------------------------- */

router.get('/balance', requireUser, asyncHandler(async (req, res) => {
  const trial = await ensureTrialGranted(req.userId, {
    installId: req.get('x-install-id') || null,
  });

  // A subscriber's next cycle is credited by an hourly job, and between the
  // instant the old cycle expired and that job running they read zero. The home
  // screen calls this on mount, so crediting it here is what makes the gap
  // invisible — and it uses the job's own idempotency key, so the two can never
  // both credit the same cycle. No-op for everyone else.
  await ensureCurrentCycle(req.userId, new Date(), await loadBalanceUser(req.userId));

  const balance = await balanceSnapshot(await loadBalanceUser(req.userId));

  res.json({
    ...balance,
    // Flat fees are stated, never hidden. The client renders them on the
    // pricing screen next to the per-minute rate.
    costs: {
      practiceAnswerSeconds: balance.plan === 'premium' ? 0 : CFG.practiceAnswer(),
      cvAnalysisSeconds: balance.plan === 'premium' ? 0 : CFG.cvPrepare(),
      // A subscriber's floor is one heartbeat rather than nothing — see the
      // note on advanceMeeting(): a turn that costs nothing can be issued in
      // parallel for nothing. It never binds on a real exchange.
      minTurnSeconds: balance.plan === 'premium'
        ? Math.min(CFG.minTurn(), CFG.tick())
        : CFG.minTurn(),
      minStartSeconds: CFG.minStart(),
    },
    trialJustGranted: Boolean(trial.granted),
    trialSeconds: CFG.trial(),
  });
}));

/* -------------------------------------------------------------------------
 * GET /api/user/ledger — the statement.
 *
 * Every grant and every interview, with dates and a running balance. This is
 * what turns "where did my minutes go?" from a support ticket into a screen.
 * ---------------------------------------------------------------------- */

const ledgerQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.string().regex(/^\d+$/).optional(),
});

router.get('/ledger', requireUser, asyncHandler(async (req, res) => {
  const { limit, before } = ledgerQuery.parse(req.query);
  const entries = await ledgerFor(req.userId, {
    limit,
    before: before ? BigInt(before) : undefined,
  });
  const balance = await balanceSnapshot(await loadBalanceUser(req.userId));

  res.json({
    entries,
    balance,
    // Keyset pagination: the ledger is append-only and unbounded, and OFFSET
    // paging over an append-only table shifts rows under the reader.
    nextBefore: entries.length === limit ? entries[entries.length - 1].id : null,
  });
}));

router.get('/stats', requireUser, asyncHandler(async (req, res) => {
  // Raw mysql2 — Prisma panics on Hostinger OpenSSL 1.1.x.
  const uid = req.userId.toString();
  const [totalRow, answerRow, recent, breakdown] = await Promise.all([
    queryOne('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', [uid]),
    queryOne(
      `SELECT COUNT(*) AS n, AVG(a.ai_score) AS avg FROM answers a
       JOIN sessions s ON s.id = a.session_id
       WHERE s.user_id = ? AND a.ai_score IS NOT NULL`,
      [uid]
    ),
    query(
      `SELECT s.id, s.total_score AS totalScore, s.started_at AS startedAt, s.ended_at AS endedAt,
              c.name_ar AS categoryNameAr, c.name_en AS categoryNameEn
       FROM sessions s
       JOIN categories c ON c.id = s.category_id
       WHERE s.user_id = ?
       ORDER BY s.started_at DESC LIMIT 10`,
      [uid]
    ),
    query(
      `SELECT s.category_id AS categoryId,
              COUNT(*) AS sessionCount,
              AVG(s.total_score) AS avgScore
       FROM sessions s
       WHERE s.user_id = ?
       GROUP BY s.category_id`,
      [uid]
    ),
  ]);

  for (const s of recent) {
    s.category = { nameAr: s.categoryNameAr, nameEn: s.categoryNameEn };
    delete s.categoryNameAr; delete s.categoryNameEn;
  }

  res.json({
    totalSessions: Number(totalRow?.n || 0),
    totalAnswers: Number(answerRow?.n || 0),
    averageScore: Number(answerRow?.avg ?? 0),
    recentSessions: recent,
    categoryBreakdown: breakdown.map((b) => ({
      categoryId: b.categoryId,
      _count: { _all: Number(b.sessionCount) },
      _avg: { totalScore: Number(b.avgScore ?? 0) },
    })),
  });
}));

export default router;
