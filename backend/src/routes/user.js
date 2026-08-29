import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { prisma } from '../db/prisma.js';
import { query, queryOne } from '../db/mysql.js';
import { requireUser } from '../middleware/auth.js';
import { upsertToken, detachToken } from '../services/push/audience.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import {
  balanceSnapshot, loadBalanceUser, ledgerFor, ensureTrialGranted, CFG,
} from '../services/billing/minutes.js';
import { ensureCurrentCycle } from '../services/billing/cycles.js';
import { hasUsablePassword } from '../services/auth/googleIdentity.js';

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
    // Emitted here as well as from /auth/google, and that is the whole point:
    // the app caches whatever /user/me returns, so a payload without the avatar
    // ERASES the picture the Google sign-in had just supplied. The account
    // photo appeared once and became an initial on the next launch.
    avatarUrl: u.avatarUrl ?? null,
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
    // Whether a password can be used to sign in or to confirm deletion. False
    // for a Google-only account, and the client needs it: a screen that demands
    // a password from someone who has never had one is a dead end.
    hasPassword: hasUsablePassword(u.passwordHash),
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
  // A stolen session token must not be enough to destroy someone's account —
  // for an account that HAS a password. Optional because one kind of account
  // does not; see below.
  password: z.string().min(1).optional(),
});

router.delete('/me', requireUser, asyncHandler(async (req, res) => {
  const { password } = deleteSchema.parse(req.body ?? {});

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new HttpError(404, 'User not found');

  /*
   * An account created through "sign in with Google" has no password to
   * re-enter, so demanding one would make it undeletable — and Google Play
   * requires in-app deletion, so that is a policy failure and not merely an
   * inconvenience. `hasUsablePassword` distinguishes the two cases from the
   * stored value itself: a real bcrypt hash starts with `$2`, the no-password
   * sentinel does not.
   *
   * The bar is not lowered by accident. For a password account the password is
   * still mandatory; for a Google account the valid access token IS the second
   * factor, because it can only have come from a completed Google sign-in.
   */
  if (hasUsablePassword(user.passwordHash)) {
    if (!password) {
      throw new HttpError(400, 'كلمة المرور مطلوبة / Password required', undefined, 'PASSWORD_REQUIRED');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new HttpError(401, 'كلمة المرور غير صحيحة / Password incorrect', undefined, 'BAD_PASSWORD');
  }

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
        email: `deleted-${id}@deleted.interprova.app`,
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

/* -------------------------------------------------------------------------
 * PUSH — the device address book, from the device's side.
 *
 * A handset registers its FCM token here on launch, and that call MUST work
 * while signed out. `device_tokens.user_id` is nullable for exactly this
 * reason: an install that has not signed in yet is still a device we can
 * reach, and requiring a session here would make every signed-out install
 * permanently unaddressable — including by the one notification that would
 * bring it back.
 *
 * The inverse of register is DETACH, never delete. Sign-out nulls the row's
 * user_id and keeps the address; deleting it is why "notify me when I log back
 * in" quietly stops working on that handset, forever, with nothing in any log.
 * ---------------------------------------------------------------------- */

/**
 * Bearer auth that never rejects.
 *
 * Delegates to requireUser instead of calling jwt.verify again, so the two can
 * never drift: whatever requireUser accepts (secret, token type, expiry) is
 * exactly what sets req.userId here, and anything it refuses just leaves the
 * request anonymous. So an EXPIRED access token registers the device as
 * signed-out rather than 401-ing — the device stays reachable either way, and
 * the client re-registers after its next refresh, which restores the link.
 */
function optionalUser(req, res, next) {
  if (!req.headers.authorization) return next();
  requireUser(req, res, () => next());
}

/**
 * /push/register is an unauthenticated INSERT into a table keyed by a string
 * the caller chooses — a table-filling primitive without a cap, because a loop
 * sending a fresh random `token` each time adds a row each time and nothing
 * ever removes them: a token is only retired when FCM reports it dead, and FCM
 * is never asked about a token nobody sends to.
 *
 * Keyed on the IP alone, deliberately: the install id is an attacker-supplied
 * header, so keying on it would let the same loop rotate out of its own limit.
 * The /64 collapse is repeated here in miniature because middleware/rateLimit.js
 * exports finished limiters rather than a factory and keeps that helper
 * private. The ceiling is far above an office or a household behind one NAT on
 * an endpoint each device calls about once per launch.
 *
 * NOTE: middleware/rateLimit.js:normaliseIp() still collapses the prefix with
 * the naive slice this file used to use, so registerLimiter and every
 * userOrIpKey limiter are still bypassable by an IPv6 client the way described
 * below. Fixing it there is the same three lines.
 */

/**
 * The eight hextets of an IPv6 address, with the `::` run written out.
 *
 * Slicing four groups off `addr.split(':')` is the obvious way to take a /64
 * and it is wrong for precisely the addresses that reach a server: the value
 * behind req.ip is the canonical COMPRESSED form, so '2001:db8::5' splits into
 * ['2001','db8','','5'] and taking four of those reproduces the whole address.
 * The key became '2001:db8::5::/64' — a fresh bucket per low hextet, which is
 * no limit at all for any host whose /64 prefix contains a zero group, and most
 * of them do. Expanding first makes every address in one /64 collapse to one
 * key, which is the entire point of the exercise.
 *
 * express-rate-limit v7.5 ships ipKeyGenerator for this, but the copy installed
 * here does not export it, so the helper stays local.
 *
 * A zone suffix ('fe80::1%eth0') is dropped and leading zeros are stripped, so
 * two spellings of one host cannot buy two budgets. A malformed address yields
 * a garbage-but-stable key rather than a throw: this runs before the handler on
 * every register call, and a keyGenerator that throws is a 500 on a route whose
 * whole job is to keep a device reachable.
 */
function expandV6(addr) {
  const [head, tail = ''] = addr.split('%')[0].toLowerCase().split('::');
  const lead = head ? head.split(':') : [];
  const trail = tail ? tail.split(':') : [];
  const gap = Math.max(0, 8 - lead.length - trail.length);
  return [...lead, ...Array(gap).fill('0'), ...trail].map((h) => h.replace(/^0+(?=.)/, ''));
}

const pushRegisterLimiter = rateLimit({
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  windowMs: 60 * 60 * 1000,
  max: 60,
  keyGenerator: (req) => {
    const ip = req.ip || 'unknown';
    const addr = ip.startsWith('::ffff:') ? ip.slice(7) : ip; // IPv4-mapped
    if (!addr.includes(':')) return addr;                     // IPv4
    return `${expandV6(addr).slice(0, 4).join(':')}::/64`;
  },
  message: { error: 'محاولات تسجيل كثيرة. حاول لاحقًا / Too many device registrations, try again later' },
});

/**
 * An FCM registration token is opaque — there is no format to validate — so the
 * only two checks worth making are the two that fail silently.
 *
 * Empty is an address to nowhere. Longer than 255 is worse: the column is
 * VARCHAR(255), so the value is either truncated or rejected by MySQL deep
 * inside the upsert, and a TRUNCATED token is the bad one — a perfectly
 * well-formed row that FCM will never deliver to, that nothing ever retires
 * (FCM is never asked about it), and that no report shows as wrong. A 400 here
 * is the only place that difference is still visible.
 */
function readPushToken(raw) {
  const token = typeof raw === 'string' ? raw.trim() : '';
  if (!token) {
    throw new HttpError(400, 'رمز الجهاز مفقود / Device token missing', undefined, 'PUSH_TOKEN_REQUIRED');
  }
  if (token.length > 255) {
    throw new HttpError(400, 'رمز الجهاز غير صالح / Device token exceeds 255 characters', undefined, 'PUSH_TOKEN_INVALID');
  }
  return token;
}

/*
 * platform and language are NORMALISED, not validated, and for opposite
 * reasons. platform is a label — nothing is addressed by it — so 400-ing an
 * unfamiliar value would leave a perfectly reachable device unregistered over
 * a cosmetic field. language is not cosmetic (it selects which copy of a
 * notification the device receives), which is precisely why an unrecognised
 * locale must fall to Arabic — the copy that always exists — instead of
 * failing the call and receiving nothing at all.
 */
const PUSH_PLATFORMS = ['android', 'ios', 'web'];
const readPlatform = (raw) => {
  const p = String(raw ?? '').trim().toLowerCase();
  return PUSH_PLATFORMS.includes(p) ? p : 'android';
};
const readLanguage = (raw) => (String(raw ?? '').trim().toLowerCase().startsWith('en') ? 'en' : 'ar');

const pushRegisterSchema = z.object({
  token: z.string(),
  platform: z.string().max(32).optional(),
  language: z.string().max(16).optional(),
  appVersion: z.string().max(32).optional(),
});

const pushUnregisterSchema = z.object({
  token: z.string(),
});

router.post('/push/register', pushRegisterLimiter, optionalUser, asyncHandler(async (req, res) => {
  const body = pushRegisterSchema.parse(req.body ?? {});

  await upsertToken({
    token: readPushToken(body.token),
    // Anonymous is a legitimate outcome here, not a failure — see optionalUser.
    userId: req.userId ?? null,
    platform: readPlatform(body.platform),
    language: readLanguage(body.language),
    // The same header the trial claim and the meeting routes already read, so a
    // token can be tied back to an install without inventing a second id.
    installId: req.get('x-install-id') || null,
    appVersion: body.appVersion ?? null,
  });

  res.json({ ok: true });
}));

/*
 * Sign-out. Unauthenticated on purpose and safe to be: detachToken only NULLs
 * user_id, so the worst a caller can do with a token they already hold is
 * unlink it — never silence the device and never delete the address. It is
 * also called at the exact moment the client is discarding its access token,
 * so demanding one would make the common path the failing path.
 */
router.post('/push/unregister', optionalUser, asyncHandler(async (req, res) => {
  const body = pushUnregisterSchema.parse(req.body ?? {});
  await detachToken(readPushToken(body.token), req.userId ?? null);
  res.json({ ok: true });
}));

/* -------------------------------------------------------------------------
 * GET /api/user/notifications — the inbox.
 *
 * A push that arrives while the phone is off, or is swiped away, is gone. This
 * is where it still exists afterwards, which is what makes a notification worth
 * sending at all: "you have 3 minutes left" is useless if the only copy died on
 * a lock screen.
 *
 * Both copies of every row are returned, never one. Which language to render is
 * the client's call — the device's language can change between the send and the
 * read, and the row records what was sent, not what should be displayed now.
 * ---------------------------------------------------------------------- */

const notificationsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

router.get('/notifications', requireUser, asyncHandler(async (req, res) => {
  const { limit } = notificationsQuery.parse(req.query);

  // Raw mysql2 — Prisma panics on Hostinger OpenSSL 1.1.x.
  //
  // The predicate keys on OWNERSHIP, not on the literal 'all'. A broadcast row
  // carries no user_id whichever segment it was aimed at, so testing
  // `audience = 'all'` recognised one of the five audiences the panel offers
  // (services/push/audience.js:AUDIENCES): a send to 'subscribers', 'trial' or
  // 'recent' has audience <> 'all' AND user_id NULL, matched neither arm, and
  // appeared in nobody's inbox. The banner still landed on the lock screen, so
  // nothing looked broken until someone swiped one away and came here to read
  // it again — which is the single case this endpoint exists for.
  //
  // A segment row is shown to every reader, not only to the devices that were
  // targeted, because nothing records the recipient list: one row is written
  // per send, and who is a subscriber at read time is not who was one at send
  // time. Over-broad is the safe direction — this is operator-written
  // announcement copy with no personal data in it, and the alternative is a
  // message that exists nowhere.
  //
  // `user_id IS NOT NULL` is not redundant. sendNotification() writes the id
  // through bigParam(), which returns NULL for a malformed value (notify.js
  // rejects only null/undefined before that, never the shape), so an
  // audience 'user' row can reach the table with no owner. A bare
  // `user_id IS NULL` broadcast arm would publish that one personal message to
  // every inbox.
  //
  // Ordering falls back to the id because created_at is millisecond-precision
  // and one broadcast writes one row per send — ties are ordinary, and an
  // unstable order shuffles the inbox between two reads of the same data.
  const rows = await query(
    `SELECT id, title_ar AS titleAr, body_ar AS bodyAr, title_en AS titleEn, body_en AS bodyEn,
            route, audience, kind, created_at AS createdAt
     FROM notifications
     WHERE (user_id IS NOT NULL AND user_id = ?)
        OR (user_id IS NULL AND audience <> 'user')
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    [req.userId.toString(), limit]
  );

  res.json({
    notifications: rows.map((n) => ({
      // Stringified for the same reason toPublicUser stringifies the user id:
      // these are BIGINTs, and a client that parses one as a JSON number is
      // storing an id it may not be able to send back unchanged.
      id: String(n.id),
      titleAr: n.titleAr,
      bodyAr: n.bodyAr,
      titleEn: n.titleEn,
      bodyEn: n.bodyEn,
      route: n.route,
      audience: n.audience,
      kind: n.kind,
      createdAt: n.createdAt,
    })),
  });
}));

export default router;
