import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { prisma } from '../db/prisma.js';
import { query, queryOne } from '../db/mysql.js';
import { authLimiter, integrationTestLimiter } from '../middleware/rateLimit.js';
import { requireAdmin, signAdminToken } from '../middleware/auth.js';
import { auditAdminMutations, clientIp } from '../middleware/auditLog.js';
import { writeAudit, logAudit } from '../services/audit.js';
import { cairoToday } from '../services/quota.js';
import { PLANS, computeExpiry } from '../services/payments/plans.js';
import {
  grantSeconds, clawbackSeconds, balanceSnapshot, loadBalanceUser, ledgerFor,
} from '../services/billing/minutes.js';
import { normaliseEgyptianMobile } from '../services/payments/easykash.js';
import { WIRED_KEYS, RETIRED_KEYS, reloadAppSettings } from '../services/appSettings.js';
import { credentialDef, validateValue } from '../services/secrets/registry.js';
import {
  credentialStatus, writeCredential, deleteCredential, reloadCredentials, isCryptoAvailable,
} from '../services/secrets/store.js';
import { probeCredential } from '../services/secrets/probe.js';
import {
  isConfigured as pushConfigured, serviceAccount, buildMessage, sendToTokens,
} from '../services/push/fcm.js';
import {
  AUDIENCES, tokensForAudience, retireToken, deviceCounts,
} from '../services/push/audience.js';
import { pushEnabled, sendNotification } from '../services/push/notify.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';

const router = Router();

// Every successful admin mutation below is recorded in `admin_audit_logs`.
// One insertion point, so the trail cannot rot when a handler is rewritten.
router.use(auditAdminMutations());

/* -----------------------------  auth  ----------------------------- */

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

/** Route params are user input: BigInt('abc') throws a TypeError -> 500. */
function bigId(value, label = 'id') {
  if (!/^\d+$/.test(String(value ?? ''))) throw new HttpError(400, `Invalid ${label}`);
  return BigInt(value);
}

/* ---------------  entitlement invariants (users + subscriptions)  --------------- */

/**
 * The response shape for an end user. `prisma.user.*` returns every scalar,
 * including `password_hash` — PATCH /users/:id used to hand the bcrypt hash of
 * the account it had just edited straight back to the browser. Every handler
 * that answers with a User row goes through here.
 */
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone ?? null,
    language: u.language,
    plan: u.plan,
    dailyQuestionsUsed: u.dailyQuestionsUsed,
    lastResetDate: u.lastResetDate ?? null,
    premiumUntil: u.premiumUntil ?? null,
    isDisabled: !!u.isDisabled,
    emailVerifiedAt: u.emailVerifiedAt ?? null,
    lastLoginAt: u.lastLoginAt ?? null,
    createdAt: u.createdAt,
  };
}

/**
 * Re-derive `users.plan` / `users.premium_until` from the subscription rows.
 *
 * This is THE invariant of the whole monetisation surface: services/quota.js
 * gates every answer submission on `plan === 'premium' && premiumUntil > now`
 * and never joins subscriptions, so the mirror is the entitlement and the
 * subscription table is only the ledger that explains it. Deriving instead of
 * assigning is what makes the pair impossible to desync — revoking one of two
 * overlapping subscriptions re-points the mirror at the survivor rather than
 * dropping a paying customer to free.
 *
 * Always called with a transaction client, so the row and the mirror move
 * together or not at all.
 */
async function syncPremiumMirror(tx, userId, now = new Date()) {
  const covering = await tx.subscription.findFirst({
    where: { userId, status: 'active', expiresAt: { gt: now } },
    orderBy: { expiresAt: 'desc' },
    select: { expiresAt: true },
  });
  const data = covering
    ? { plan: 'premium', premiumUntil: covering.expiresAt }
    : { plan: 'free', premiumUntil: null };
  await tx.user.update({ where: { id: userId }, data });
  return data;
}

/**
 * Pin a user row for the whole read-decide-write cycle of an entitlement change.
 *
 * Everything below used to read the user, the disabled flag and the covering
 * subscription OUTSIDE the transaction and only then write. MySQL's default
 * REPEATABLE READ does not serialise those two windows, so two agents granting
 * 30 days to the same account within the same minute both read the same current
 * expiry, both computed the same target, and the customer received 30 days
 * while the trail recorded two 30-day grants. `SELECT … FOR UPDATE` is the same
 * lock services/billing/minutes.js takes before it spends anything: the second
 * transaction queues on it and reads the first one's result.
 */
async function lockUserRow(tx, userId) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(404, 'المستخدم غير موجود / User not found', undefined, 'USER_NOT_FOUND');
  return user;
}

/**
 * Back a hand-made entitlement with a real Subscription row.
 *
 * `provider = 'manual'` is the marker: the enum value has existed since
 * migration 001 with nothing ever writing it, the admin grid already renders a
 * chip for it, and it is what distinguishes a goodwill grant from paid access
 * without lying about where the money came from. No Payment row is created —
 * revenue reporting stays money-only.
 *
 * ONLY called when nothing else covers the user. A grant to someone who is
 * already covered extends the row they have (extendCoveringSubscription below);
 * creating a second row and superseding the first is what rewrote paid history
 * and refilled allowances. Every other active row is still superseded here, so
 * exactly one subscription resolves coverage (the same rule
 * routes/payments.js:activateSubscription enforces) — those rows are lapsed or
 * cancelled ones, and folding their time in is the caller's job.
 *
 * A manual row grants NO minutes: services/maintenance.js skips
 * provider='manual' when it credits cycle allowances, because a one-day
 * goodwill grant is not a 300-minute month. Minutes are credited deliberately,
 * through POST /users/:id/minutes, where they get a Payment row and a reason.
 */
async function grantManualSubscription(tx, {
  user, expiresAt, planCode, reason, adminId, ip, via, days = null,
}) {
  const now = new Date();

  const superseded = await tx.subscription.findMany({
    where: { userId: user.id, status: 'active' },
    select: { id: true },
  });
  if (superseded.length) {
    await tx.subscription.updateMany({
      where: { id: { in: superseded.map((s) => s.id) } },
      data: { status: 'expired' },
    });
  }
  const supersededIds = superseded.map((s) => s.id.toString());

  const subscription = await tx.subscription.create({
    data: {
      userId: user.id,
      provider: 'manual',
      // provider_ref is UNIQUE NOT NULL VarChar(191); mirrors the reference
      // convention in routes/payments.js so a manual row is recognisable.
      providerRef: `manual_${user.id}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`,
      planCode,
      status: 'active',
      autoRenew: false,
      startedAt: now,
      expiresAt,
      rawPayload: JSON.stringify({
        grantedByAdminId: adminId.toString(),
        reason,
        days,
        via,
        supersededIds,
        previousPremiumUntil: user.premiumUntil ?? null,
      }),
    },
  });

  const mirror = await syncPremiumMirror(tx, user.id, now);

  await writeAudit(tx, {
    adminId,
    action: 'subscriptions.grant',
    entityType: 'subscription',
    entityId: subscription.id.toString(),
    metadata: {
      userId: user.id.toString(),
      userEmail: user.email,
      provider: 'manual',
      planCode,
      days,
      reason,
      via,
      supersededIds,
      previousPremiumUntil: user.premiumUntil ? user.premiumUntil.toISOString() : null,
      expiresAt: expiresAt.toISOString(),
      premiumUntil: mirror.premiumUntil ? mirror.premiumUntil.toISOString() : null,
    },
    ip,
  });

  return { subscription, mirror, supersededIds };
}

/**
 * Extend the subscription that already covers a user — in place.
 *
 * Two things broke when a grant created a second row and superseded the first:
 *
 * 1. PROVENANCE. Superseding a provider='easykash' row moved coverage onto a
 *    provider='manual' one, so a customer who paid 399 EGP for a quarter read
 *    as a manual grant everywhere except the payments table. PATCH
 *    /subscriptions/:id already refuses exactly this — "an EasyKash row
 *    extended as goodwill stays EasyKash, because rewriting it to manual would
 *    erase where the money came from" — and the grant path now agrees with it.
 *    `planCode` is left alone for the same reason: a paid quarterly row is not
 *    relabelled 'monthly' because someone granted 30 goodwill days.
 *
 * 2. MINUTES. A new row starts a new allowance cycle at `startedAt = now`, and
 *    grantSeconds() REPLACES the subscription bucket rather than adding to it
 *    (services/billing/minutes.js). One goodwill day granted to a subscriber
 *    who had burned 290 of their 300 cycle minutes refilled all 300 — and
 *    repeating the one-day grant refilled them again, without limit and without
 *    a Payment row. Extending the existing row keeps the cycle numbering
 *    services/maintenance.js derives from `startedAt`, so the already-used
 *    cycle stays used.
 */
async function extendCoveringSubscription(tx, {
  user, subscription, expiresAt, reason, adminId, ip, via, days = null,
}) {
  const now = new Date();

  const updated = await tx.subscription.update({
    where: { id: subscription.id },
    data: {
      expiresAt,
      rawPayload: JSON.stringify({
        previous: {
          status: subscription.status,
          expiresAt: subscription.expiresAt.toISOString(),
          planCode: subscription.planCode,
        },
        grantedByAdminId: adminId.toString(),
        grantedAt: now.toISOString(),
        reason,
        days,
        via,
        // The gateway's own payload is the only record of what the provider
        // actually said; keep it rather than overwriting it with a grant note.
        original: subscription.rawPayload ? subscription.rawPayload.slice(0, 40000) : null,
      }).slice(0, 60000),
    },
  });

  const mirror = await syncPremiumMirror(tx, user.id, now);

  await writeAudit(tx, {
    adminId,
    action: 'subscriptions.grant',
    entityType: 'subscription',
    entityId: subscription.id.toString(),
    metadata: {
      // Says which of the two shapes a grant took, so the trail distinguishes
      // "a new manual row" from "the paid row was extended".
      mode: 'extend_in_place',
      userId: user.id.toString(),
      userEmail: user.email,
      provider: subscription.provider,
      planCode: subscription.planCode,
      days,
      reason,
      via,
      previousExpiresAt: subscription.expiresAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      premiumUntil: mirror.premiumUntil ? mirror.premiumUntil.toISOString() : null,
    },
    ip,
  });

  return { subscription: updated, mirror, supersededIds: [] };
}

/**
 * The ONE way access is granted by hand, from the users drawer and from
 * /subscriptions alike: extend what already covers the user, or create a manual
 * row when nothing does. Both callers must resolve `covering` inside the same
 * transaction, under lockUserRow().
 */
function applyManualGrant(tx, { covering, planCode, ...rest }) {
  return covering
    ? extendCoveringSubscription(tx, { subscription: covering, ...rest })
    : grantManualSubscription(tx, { planCode, ...rest });
}

router.post('/auth/login', authLimiter, asyncHandler(async (req, res) => {
  const body = loginSchema.parse(req.body);
  const admin = await prisma.adminUser.findUnique({ where: { email: body.email } });
  if (!admin || !admin.isActive) throw new HttpError(401, 'Invalid credentials');
  const ok = await bcrypt.compare(body.password, admin.passwordHash);
  if (!ok) throw new HttpError(401, 'Invalid credentials');
  // Without this the admin_users.last_login_at column is always null, and
  // "is anyone still using this account?" has no answer on the Admins page.
  await prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
  // Lets the audit middleware attribute the sign-in. Failed attempts throw
  // above, so only successful logins are recorded.
  req.admin = admin;
  res.json({
    admin: { id: admin.id.toString(), email: admin.email, name: admin.name, role: admin.role },
    token: signAdminToken(admin),
  });
}));

router.get('/auth/me', requireAdmin(), asyncHandler(async (req, res) => {
  const a = req.admin;
  res.json({ admin: { id: a.id.toString(), email: a.email, name: a.name, role: a.role } });
}));

/* -------------------------  users management  -------------------------- */

router.get('/users', requireAdmin(), asyncHandler(async (req, res) => {
  // Uses mysql2 directly: Prisma's library engine panics with "timer has
  // gone away" on the Hostinger OpenSSL 1.1.x runtime for findMany queries
  // with where+orderBy+skip+take. Raw SQL works reliably.
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const offset = (page - 1) * limit;
  const q = (req.query.q || '').toString().trim();

  const clauses = [];
  const params = [];
  if (q) {
    // Parenthesised: without it an added filter would bind only to `name LIKE`.
    clauses.push('(email LIKE ? OR name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }

  // `plan` alone is not a truth: services/quota.js gates on premium_until, so
  // the filter distinguishes real premium from a lapsed row the same way.
  const plan = (req.query.plan || '').toString();
  if (plan === 'free') {
    clauses.push('plan = ?');
    params.push('free');
  } else if (plan === 'premium') {
    clauses.push('plan = ? AND premium_until IS NOT NULL AND premium_until > ?');
    params.push('premium', new Date());
  } else if (plan === 'premium_expired') {
    clauses.push('plan = ? AND (premium_until IS NULL OR premium_until <= ?)');
    params.push('premium', new Date());
  }

  const status = (req.query.status || '').toString();
  if (status === 'active') clauses.push('is_disabled = 0');
  else if (status === 'disabled') clauses.push('is_disabled = 1');

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const [users, countRow] = await Promise.all([
    query(
      `SELECT id, email, name, phone, language, plan, daily_questions_used AS dailyQuestionsUsed,
              last_reset_date AS lastResetDate, premium_until AS premiumUntil,
              is_disabled AS isDisabled, email_verified_at AS emailVerifiedAt,
              last_login_at AS lastLoginAt, created_at AS createdAt
       FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ),
    queryOne(`SELECT COUNT(*) AS n FROM users ${where}`, params),
  ]);
  // Normalize 0/1 ints to booleans (matches Prisma's output shape).
  for (const u of users) u.isDisabled = !!u.isDisabled;
  res.json({ users, page, limit, total: Number(countRow?.n || 0) });
}));

/**
 * One user + the aggregates the detail page needs. Without this the admin can
 * list users and read their sessions but never open a single account.
 */
router.get('/users/:id', requireAdmin(), asyncHandler(async (req, res) => {
  const id = bigId(req.params.id, 'user id').toString();

  const user = await queryOne(
    `SELECT id, email, name, phone, language, plan, daily_questions_used AS dailyQuestionsUsed,
            last_reset_date AS lastResetDate, premium_until AS premiumUntil,
            is_disabled AS isDisabled, email_verified_at AS emailVerifiedAt,
            last_login_at AS lastLoginAt, created_at AS createdAt
     FROM users WHERE id = ?`,
    [id]
  );
  if (!user) throw new HttpError(404, 'User not found');
  user.isDisabled = !!user.isDisabled;

  const [sessionStats, subRow] = await Promise.all([
    queryOne(
      // avgScore is per answer: total_score is a SUM of answer scores, so the
      // raw column is not comparable between a 3-answer and a 10-answer run.
      `SELECT COUNT(*) AS sessionsCount,
              COALESCE(SUM(answer_count), 0) AS answersCount,
              SUM(CASE WHEN ended_at IS NOT NULL THEN 1 ELSE 0 END) AS completedCount,
              ROUND(SUM(total_score) / NULLIF(SUM(answer_count), 0), 1) AS avgScore,
              MAX(started_at) AS lastSessionAt
       FROM sessions WHERE user_id = ?`,
      [id]
    ),
    queryOne(
      `SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ?`,
      [id]
    ),
  ]);

  res.json({
    user,
    stats: {
      sessionsCount: Number(sessionStats?.sessionsCount || 0),
      completedCount: Number(sessionStats?.completedCount || 0),
      answersCount: Number(sessionStats?.answersCount || 0),
      // null (never answered) stays null — a fabricated 0 reads as "scored zero".
      avgScore: sessionStats?.avgScore === null || sessionStats?.avgScore === undefined
        ? null
        : Number(sessionStats.avgScore),
      lastSessionAt: sessionStats?.lastSessionAt ?? null,
      subscriptionsCount: Number(subRow?.n || 0),
    },
  });
}));

/**
 * Alphabet for a temporary password: no 0/O/1/l/I, because this string is read
 * down a phone line or copied by hand into a support chat.
 */
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function generateTemporaryPassword(length = 14) {
  const n = TEMP_PASSWORD_ALPHABET.length;
  // Reject the tail of the byte range so the modulo below is unbiased.
  const limit = 256 - (256 % n);
  let out = '';
  while (out.length < length) {
    for (const byte of crypto.randomBytes(length * 2)) {
      if (byte >= limit) continue;
      out += TEMP_PASSWORD_ALPHABET[byte % n];
      if (out.length === length) break;
    }
  }
  return out;
}

/**
 * Create an end-user account by hand.
 *
 * Support needs this for the cases signup cannot serve: a corporate buyer whose
 * seats are paid offline, a candidate whose registration failed at the gateway.
 *
 * WHY A TEMPORARY PASSWORD AND NOT AN INVITE LINK. There is no email sender in
 * this deployment — no SMTP config, no mail dependency, and
 * POST /api/auth/forgot-password is an acknowledged stub that issues no token
 * and sends nothing. An invite link would be a link nobody could deliver. The
 * password is returned exactly once, in this response, for the agent who is
 * already on the phone with the person — the same pattern POST /admins uses.
 *
 * Deliberately does NOT accept plan/premiumUntil: entitlement is granted
 * afterwards through POST /subscriptions, so there is exactly one code path
 * that writes the premium mirror.
 */
router.post('/users', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  const schema = z.object({
    email: z.string().email().toLowerCase(),
    name: z.string().min(2).max(120),
    language: z.enum(['ar', 'en']).default('ar'),
    // EasyKash needs a mobile on the billing payload; collecting it here saves
    // a prompt at the user's first checkout.
    phone: z.string().min(8).max(20).optional(),
  });
  const body = schema.parse(req.body);

  // Answered up front rather than left to the P2002 mapping, because "this
  // person already has an account" is only useful with the account attached.
  const existing = await prisma.user.findUnique({
    where: { email: body.email },
    select: { id: true },
  });
  if (existing) {
    throw new HttpError(
      409,
      'البريد الإلكتروني مستخدم بالفعل / Email already registered',
      { userId: existing.id.toString() },
      'EMAIL_TAKEN'
    );
  }

  const phone = body.phone ? normaliseEgyptianMobile(body.phone) : null;
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 12);

  // The automatic middleware row would carry entity_id = null: POST /users has
  // no id in the path, so the trail would record that an account was created
  // but not which one.
  req.skipAutoAudit = true;
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: body.email,
        passwordHash,
        name: body.name,
        language: body.language,
        phone,
        // cairoToday(), not new Date(): last_reset_date is a DATE column and
        // services/quota.js compares it against the Cairo day boundary.
        lastResetDate: cairoToday(),
      },
    });
    await writeAudit(tx, {
      adminId: req.admin.id,
      action: 'users.create',
      entityType: 'user',
      entityId: created.id.toString(),
      // The password exists only in the RESPONSE, which the audit middleware
      // never sees — keeping it out of here is discipline, not a framework
      // guarantee. Record that one was issued, never the value.
      metadata: {
        email: created.email,
        name: created.name,
        language: created.language,
        hasPhone: Boolean(phone),
        temporaryPasswordIssued: true,
      },
      ip: clientIp(req),
    });
    return created;
  });

  // Shown once, never retrievable: no GET returns it and no audit row holds it.
  res.status(201).json({ user: publicUser(user), temporaryPassword });
}));

router.patch('/users/:id', requireAdmin('super_admin', 'moderator'), asyncHandler(async (req, res) => {
  const schema = z.object({
    plan: z.enum(['free', 'premium']).optional(),
    isDisabled: z.boolean().optional(),
    name: z.string().min(2).max(120).optional(),
    // ISO-8601. Accepting this is what makes the "grant premium" control real:
    // services/quota.js:hasPremium() requires premiumUntil > now, so writing
    // plan alone grants nothing and reverts on the next subscription sweep.
    premiumUntil: z.union([z.string().datetime({ offset: true }), z.null()]).optional(),
    reason: z.string().min(3).max(300).optional(),
  });
  const body = schema.parse(req.body);
  const id = bigId(req.params.id, 'user id');
  const now = new Date();

  const profile = {};
  if (body.name !== undefined) profile.name = body.name;
  if (body.isDisabled !== undefined) profile.isDisabled = body.isDisabled;

  const touchesEntitlement = body.plan !== undefined || body.premiumUntil !== undefined;
  if (Object.keys(profile).length === 0 && !touchesEntitlement) {
    throw new HttpError(400, 'لا يوجد ما يتم تحديثه / Nothing to update', undefined, 'NOTHING_TO_UPDATE');
  }

  // ENTITLEMENT IS A SUPER-ADMIN ACTION WHEREVER IT IS TRIGGERED.
  //
  // This route is open to moderators because renaming and suspending accounts
  // is their job. Granting premium is not: every dedicated subscription route
  // below is requireAdmin('super_admin'), and this handler creates the same
  // provider='manual' Subscription row they do. Left ungated, a moderator could
  // mint an entitlement here — free practice answers, free CV analysis and
  // premium-only categories, at real AI cost — and then not be able to see,
  // extend or revoke it, because GET /subscriptions is closed to them.
  if (touchesEntitlement && req.admin.role !== 'super_admin') {
    throw new HttpError(
      403,
      'منح الاشتراك المميز أو إلغاؤه متاح للمدير العام فقط / Granting or clearing premium is restricted to a super admin',
      undefined,
      'ENTITLEMENT_SUPER_ADMIN_ONLY'
    );
  }
  // POST /subscriptions requires a reason because a manual grant with no stated
  // reason is unauditable. The same grant made from here is no different, so
  // the default that used to stand in for one ('Set from the user form') is
  // gone.
  if (touchesEntitlement && !body.reason) {
    throw new HttpError(
      400,
      'اكتب سبب تغيير الاشتراك — يُحفظ في سجل التدقيق / A reason is required for an entitlement change; it is recorded in the audit trail',
      undefined,
      'REASON_REQUIRED'
    );
  }

  // The whole read-decide-write cycle runs under a row lock: `existing`, the
  // disabled state and the covering subscription are all read inside the
  // transaction, so a concurrent grant cannot be computed from a stale expiry.
  const user = await prisma.$transaction(async (tx) => {
    const existing = await lockUserRow(tx, id);

    // Resolve what the caller is actually asking for as a single target expiry.
    // Clearing the expiry and selecting the free plan are the same request.
    let targetExpiry;
    if (touchesEntitlement) {
      const wantsFree = body.plan === 'free' || (body.plan === undefined && body.premiumUntil === null);
      if (wantsFree) {
        targetExpiry = null;
      } else {
        const raw = body.premiumUntil !== undefined
          ? (body.premiumUntil ? new Date(body.premiumUntil) : null)
          : existing.premiumUntil;
        if (!raw || raw.getTime() <= now.getTime()) {
          throw new HttpError(
            400,
            'منح الاشتراك المميز يتطلّب تاريخ انتهاء في المستقبل / Granting premium requires premiumUntil in the future',
            undefined,
            'PREMIUM_UNTIL_REQUIRED'
          );
        }
        targetExpiry = raw;
      }
    }

    // Suspending an account and granting it premium in one request is the same
    // contradiction POST /subscriptions refuses with USER_DISABLED — and this
    // drawer sends `isDisabled` and the plan together. Judged on the state the
    // request would LEAVE the account in, not the one it started from.
    const willBeDisabled = body.isDisabled ?? existing.isDisabled;
    if (targetExpiry && willBeDisabled) {
      throw new HttpError(
        409,
        'الحساب موقوف؛ أعِد تفعيله قبل منح الاشتراك / This account is suspended; re-enable it before granting a subscription',
        undefined,
        'USER_DISABLED'
      );
    }

    // This drawer used to write the mirror with NO subscription behind it,
    // which the hourly sweep then erased the moment any other row of that user
    // lapsed — a grant that vanished with no trace beyond its audit entry. It
    // now goes through the same path as POST /subscriptions, and refuses the
    // two cases where doing so would destroy paid access.
    const covering = touchesEntitlement
      ? await tx.subscription.findFirst({
        where: { userId: id, status: 'active', expiresAt: { gt: now } },
        orderBy: { expiresAt: 'desc' },
      })
      : null;

    if (covering) {
      if (targetExpiry === null) {
        throw new HttpError(
          409,
          'لهذا المستخدم اشتراك فعّال؛ ألغِ الاشتراك بدلًا من تصفير الصلاحية من هنا / This user has an active subscription; revoke it instead of clearing the entitlement here',
          { subscriptionId: covering.id.toString(), expiresAt: covering.expiresAt.toISOString() },
          'ACTIVE_SUBSCRIPTION_EXISTS'
        );
      }
      if (targetExpiry.getTime() < covering.expiresAt.getTime()) {
        throw new HttpError(
          409,
          'لا يمكن تقصير اشتراك فعّال من هنا؛ استخدم تعديل الاشتراك أو إلغاءه / This would shorten an active subscription; use the subscription edit or revoke instead',
          { subscriptionId: covering.id.toString(), expiresAt: covering.expiresAt.toISOString() },
          'SUBSCRIPTION_SHORTENING_BLOCKED'
        );
      }
    }

    // Re-sending the expiry the user already has is what the drawer does when
    // the operator only meant to rename someone. Touching the subscription in
    // that case would rewrite history for no reason.
    const entitlementUnchanged = Boolean(
      covering && targetExpiry && targetExpiry.getTime() === covering.expiresAt.getTime()
    );

    if (Object.keys(profile).length) await tx.user.update({ where: { id }, data: profile });

    if (touchesEntitlement) {
      if (targetExpiry && !entitlementUnchanged) {
        await applyManualGrant(tx, {
          user: existing,
          covering,
          expiresAt: targetExpiry,
          planCode: 'manual',
          reason: body.reason,
          adminId: req.admin.id,
          ip: clientIp(req),
          via: 'users.patch',
        });
      } else {
        // Nothing to grant — either the expiry is unchanged, or this is a
        // downgrade with no covering row (refused above if there were one).
        // Re-derive either way so a drifted mirror is repaired.
        await syncPremiumMirror(tx, id, now);
      }
    }
    return tx.user.findUnique({ where: { id } });
  });

  res.json({ user: publicUser(user) });
}));

/**
 * Hard-delete an account — and REFUSE to when money or minutes are attached.
 *
 * `Payment.user`, `Subscription.user` and `TimeLedgerEntry.user` are all
 * onDelete: Cascade (prisma/schema.prisma), so this statement used to destroy
 * the customer's entire financial history along with the row. Deleting someone
 * who had paid 150 EGP silently dropped 150 EGP out of GET /payments with no
 * reversing entry, left reconcileBalances() with no ledger to check, and left
 * EasyKash holding a transaction for a customer the system no longer knew.
 *
 * routes/user.js already answers this correctly for self-serve deletion: it
 * ERASES the personal data and keeps the financial rows attached to an
 * anonymous shell, which is what the privacy policy promises and what Egyptian
 * bookkeeping requires. An admin cannot be allowed to do less than that, so the
 * delete is refused here and the operator is pointed at suspension instead.
 *
 * What survives when a delete IS allowed: the audit row is written inside the
 * transaction, before the delete, and carries the identity being destroyed —
 * the automatic middleware row records `users.delete / user / 5` and nothing
 * else, because a DELETE has no body to derive metadata from.
 */
router.delete('/users/:id', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  const id = bigId(req.params.id, 'user id');
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'المستخدم غير موجود / User not found', undefined, 'USER_NOT_FOUND');

  const [payments, subscriptions, ledgerEntries] = await Promise.all([
    prisma.payment.count({ where: { userId: id } }),
    prisma.subscription.count({ where: { userId: id } }),
    prisma.timeLedgerEntry.count({ where: { userId: id } }),
  ]);

  if (payments || subscriptions || ledgerEntries) {
    throw new HttpError(
      409,
      'لهذا الحساب سجل مالي (مدفوعات أو اشتراكات أو حركات رصيد) لا يجوز حذفه؛ أوقف الحساب بدلًا من ذلك / This account has financial history (payments, subscriptions or minute ledger) that must be retained; suspend the account instead',
      { payments, subscriptions, ledgerEntries },
      'USER_HAS_FINANCIAL_HISTORY'
    );
  }

  req.skipAutoAudit = true;
  try {
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        adminId: req.admin.id,
        action: 'users.delete',
        entityType: 'user',
        entityId: id.toString(),
        // The account is about to stop existing: whatever is not recorded here
        // is unrecoverable. Written transactionally so a delete with no trace
        // cannot happen.
        metadata: {
          email: existing.email,
          name: existing.name,
          plan: existing.plan,
          premiumUntil: existing.premiumUntil ? existing.premiumUntil.toISOString() : null,
          balanceSeconds: existing.balanceSeconds,
          subSeconds: existing.subSeconds,
          createdAt: existing.createdAt.toISOString(),
          lastLoginAt: existing.lastLoginAt ? existing.lastLoginAt.toISOString() : null,
          hadFinancialHistory: false,
        },
        ip: clientIp(req),
      });
      await tx.user.delete({ where: { id } });
    });
  } catch (err) {
    // answer_reports.reporter_id is a Restrict relation (schema.prisma:353), so
    // a user who ever filed a report cannot be deleted. Unhandled this surfaced
    // as a generic 500 with no way to tell what went wrong.
    if (err?.code === 'P2003') {
      throw new HttpError(
        409,
        'This user has filed moderation reports and cannot be deleted; disable the account instead',
        undefined,
        'USER_HAS_REPORTS'
      );
    }
    throw err;
  }
  res.json({ ok: true });
}));

router.get('/users/:id/sessions', requireAdmin(), asyncHandler(async (req, res) => {
  const userId = bigId(req.params.id, 'user id').toString();
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const offset = (page - 1) * limit;

  const [sessions, countRow] = await Promise.all([
    query(
      `SELECT s.id, s.kind, s.total_score AS totalScore, s.started_at AS startedAt,
              s.ended_at AS endedAt, s.category_id AS categoryId,
              c.name_ar AS categoryNameAr, c.name_en AS categoryNameEn, c.icon AS categoryIcon,
              (SELECT COUNT(*) FROM answers a WHERE a.session_id = s.id) AS answersCount
       FROM sessions s
       JOIN categories c ON c.id = s.category_id
       WHERE s.user_id = ?
       ORDER BY s.started_at DESC LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    ),
    queryOne('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', [userId]),
  ]);

  for (const s of sessions) {
    s.category = { id: s.categoryId, nameAr: s.categoryNameAr, nameEn: s.categoryNameEn, icon: s.categoryIcon };
    delete s.categoryNameAr; delete s.categoryNameEn; delete s.categoryIcon;
    s.answersCount = Number(s.answersCount);
    s._count = { answers: s.answersCount };
  }
  res.json({ sessions, page, limit, total: Number(countRow?.n || 0) });
}));

/**
 * That user's subscription history.
 *
 * The detail page showed a `subscriptionsCount` with nothing behind it, so the
 * one question support actually asks — "what is this person's access and where
 * did it come from?" — had no answer anywhere in the admin. Read-only; the
 * grant/extend/revoke calls live under /subscriptions.
 */
router.get('/users/:id/subscriptions', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  const userId = bigId(req.params.id, 'user id').toString();
  const subscriptions = await query(
    `SELECT id, provider, provider_ref AS providerRef, plan_code AS planCode, status,
            auto_renew AS autoRenew, started_at AS startedAt, expires_at AS expiresAt,
            cancelled_at AS cancelledAt, created_at AS createdAt
     FROM subscriptions WHERE user_id = ? ORDER BY expires_at DESC, id DESC`,
    [userId]
  );
  for (const s of subscriptions) s.autoRenew = !!s.autoRenew;
  res.json({ subscriptions });
}));

/* -------------------------  minute balance  -------------------------- */

/**
 * The user's balance and their statement.
 *
 * "Where did my minutes go?" arrives at support, not at the user's own ledger
 * page, so the agent needs the same view the customer has.
 */
router.get('/users/:id/minutes', requireAdmin(), asyncHandler(async (req, res) => {
  const userId = bigId(req.params.id, 'user id');
  const user = await loadBalanceUser(userId);
  const [balance, entries] = await Promise.all([
    balanceSnapshot(user),
    ledgerFor(userId, { limit: 100 }),
  ]);
  res.json({ balance, entries });
}));

/**
 * Credit — or take back — minutes by hand.
 *
 * The credit direction is the honest bridge while EasyKash is not live: it lets
 * the owner sell time over InstaPay or Vodafone Cash and credit it the same day.
 * It is also the tool support will need for goodwill credits after the gateway
 * goes live, so it does not go away afterwards. It writes a `provider='manual'`
 * Payment row alongside the ledger entry — mirroring grantManualSubscription()'s
 * discipline — so the minutes have a document behind them, and `amountCents: 0`
 * keeps a goodwill credit out of revenue reporting.
 *
 * The deduct direction (`minutes` negative) is the correction: minutes credited
 * to the wrong account, an off-platform transfer that bounced, a promo applied
 * twice. It writes NO Payment row — nothing was sold, and inventing a negative
 * payment would corrupt the revenue figures the credit path is careful to stay
 * out of. It is `clawbackSeconds()`, so it carries that function's two rules:
 * the deduction is CLAMPED at the perpetual balance (a balance never goes
 * negative, so a user cannot be put in debt by a typo) and it only ever touches
 * the perpetual bucket — subscription allowance expires wholesale with its
 * cycle and is not withdrawable a minute at a time. The response reports what
 * was actually applied so the caller can state the clamp instead of implying
 * the full amount landed.
 *
 * Both directions require a `reason`: an unexplained balance change is
 * unauditable, and this is the one endpoint that can move a customer's money.
 */
const minutesAdjustSchema = z.object({
  // Minutes in the API because that is what a human types; seconds everywhere
  // below, because that is what the balance is measured in. Signed: positive
  // credits, negative deducts. Zero is rejected rather than being a silent
  // no-op that still writes an audit row.
  minutes: z.number().int().min(-6000).max(6000).refine((n) => n !== 0, {
    message: 'minutes must not be zero',
  }),
  reason: z.string().min(3).max(300),
  // Set when money actually changed hands off-platform, so the row can be
  // reconciled against a bank statement later. Credits only.
  amountEgp: z.number().min(0).max(100000).optional(),
});

router.post('/users/:id/minutes', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  const userId = bigId(req.params.id, 'user id');
  const body = minutesAdjustSchema.parse(req.body ?? {});

  const isCredit = body.minutes > 0;
  const requestedSeconds = Math.abs(body.minutes) * 60;
  const reference = isCredit
    ? `manual_${userId}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`
    : null;

  // THE PAYMENT, THE LEDGER AND THE AUDIT ROW ARE ONE TRANSACTION.
  //
  // They used to be three statements in sequence. grantSeconds() takes a row
  // lock, so it can fail on a lock-wait timeout while the customer is in a live
  // meeting — and when it did, the Payment row was already committed: 100 EGP
  // of recorded revenue, no minutes delivered, no ledger row, and logAudit()
  // never reached, so no trail either. The agent's natural retry then created a
  // SECOND Payment row with a new id, hence a new idempotency key, so nothing
  // deduped it: 200 EGP recorded for 100 EGP received.
  req.skipAutoAudit = true;
  const { appliedSeconds } = await prisma.$transaction(async (tx) => {
    const user = await lockUserRow(tx, userId);
    // A suspended account blocks a CREDIT (do not hand minutes to an account
    // that cannot use them, and re-enabling first forces the operator to decide
    // about the suspension). A DEDUCTION is allowed: taking minutes back off a
    // suspended account is exactly what you want to do while it is suspended.
    if (user.isDisabled && isCredit) {
      throw new HttpError(
        409,
        'الحساب موقوف؛ أعِد تفعيله قبل منح الدقائق / This account is suspended; re-enable it before granting minutes',
        undefined,
        'USER_DISABLED',
      );
    }

    let payment = null;
    let applied = 0;

    if (isCredit) {
      payment = await tx.payment.create({
        data: {
          userId,
          provider: 'manual',
          reference,
          planCode: 'manual_minutes',
          amountCents: Math.round((body.amountEgp ?? 0) * 100),
          currency: 'EGP',
          status: 'paid',
          method: 'manual',
          paidAt: new Date(),
        },
      });

      const granted = await grantSeconds({
        tx,
        userId,
        seconds: requestedSeconds,
        kind: 'admin_grant',
        bucket: 'perpetual',
        paymentId: payment.id,
        adminId: req.admin.id,
        idempotencyKey: `payment:${payment.id}`,
        note: body.reason,
      });
      applied = granted.granted ? requestedSeconds : 0;
    } else {
      const clawed = await clawbackSeconds({
        tx,
        userId,
        seconds: requestedSeconds,
        // 'adjustment', not 'refund': no money moved, so the ledger must not
        // let this be read as a gateway refund when the two are reconciled.
        kind: 'adjustment',
        adminId: req.admin.id,
        // Not payment-keyed: a deduction has no payment behind it. Two
        // identical corrections are two real corrections — an operator who
        // deducts 10 minutes twice meant to deduct 20 — so the key is unique
        // per request rather than per (admin, user, amount). The random suffix
        // is what stops a double-submitted form inside the same millisecond
        // from throwing a duplicate key and 500-ing instead of applying.
        idempotencyKey: `admin:${req.admin.id}:deduct:${userId}:${Date.now().toString(36)}:${crypto.randomBytes(4).toString('hex')}`,
        note: body.reason,
      });
      applied = clawed.clawed;
    }

    await writeAudit(tx, {
      adminId: req.admin.id,
      // `resource.verb`, the shape middleware/auditLog.js writes and the admin
      // panel's audit filter groups by. A bare `grant_minutes` sorted under a
      // resource called "grant_minutes" and read as an untranslated verb.
      action: isCredit ? 'users.grant_minutes' : 'users.deduct_minutes',
      entityType: 'user',
      entityId: userId.toString(),
      metadata: {
        minutes: body.minutes,
        requestedSeconds,
        // What actually landed. On a deduction the clamp can make this smaller
        // than the request, and the trail has to record the outcome, not the
        // intention.
        appliedSeconds: applied,
        reason: body.reason,
        reference,
        amountEgp: isCredit ? (body.amountEgp ?? 0) : 0,
        paymentId: payment ? payment.id.toString() : null,
        userEmail: user.email,
      },
      ip: clientIp(req),
    });

    return { appliedSeconds: applied };
  });

  const balance = await balanceSnapshot(await loadBalanceUser(userId));
  res.status(201).json({
    ok: true,
    direction: isCredit ? 'credit' : 'deduct',
    requestedSeconds,
    appliedSeconds,
    // > 0 only when a deduction hit the clamp: the minutes were already spent.
    unappliedSeconds: requestedSeconds - appliedSeconds,
    reference,
    balance,
  });
}));

/* ---------------------  categories + questions  ----------------------- */

const categorySchema = z.object({
  nameAr: z.string().min(1).max(120),
  nameEn: z.string().min(1).max(120),
  // description_* and is_active exist in the schema but were absent here, so
  // the admin could never edit them at all.
  descriptionAr: z.string().max(500).nullish(),
  descriptionEn: z.string().max(500).nullish(),
  icon: z.string().max(64).nullish(),
  isPremium: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().optional(),
});

// The public GET /categories deliberately stays lean for the mobile app. The
// admin list adds the two counts the delete confirmation needs to tell the
// truth about the cascade (questions) and the block (sessions).
router.get('/categories', requireAdmin(), asyncHandler(async (_req, res) => {
  const categories = await query(
    `SELECT c.id, c.name_ar AS nameAr, c.name_en AS nameEn,
            c.description_ar AS descriptionAr, c.description_en AS descriptionEn,
            c.icon, c.is_premium AS isPremium, c.is_active AS isActive,
            c.sort_order AS sortOrder, c.created_at AS createdAt,
            (SELECT COUNT(*) FROM questions q WHERE q.category_id = c.id) AS questionCount,
            (SELECT COUNT(*) FROM sessions s WHERE s.category_id = c.id) AS sessionCount
     FROM categories c
     ORDER BY c.sort_order ASC, c.id ASC`
  );
  for (const c of categories) {
    c.isPremium = !!c.isPremium;
    c.isActive = !!c.isActive;
    c.questionCount = Number(c.questionCount);
    c.sessionCount = Number(c.sessionCount);
  }
  res.json({ categories });
}));

router.post('/categories', requireAdmin('super_admin', 'content_editor'), asyncHandler(async (req, res) => {
  const data = categorySchema.parse(req.body);
  const category = await prisma.category.create({ data });
  res.status(201).json({ category });
}));

router.patch('/categories/:id', requireAdmin('super_admin', 'content_editor'), asyncHandler(async (req, res) => {
  const data = categorySchema.partial().parse(req.body);
  const category = await prisma.category.update({ where: { id: Number(req.params.id) }, data });
  res.json({ category });
}));

router.delete('/categories/:id', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new HttpError(400, 'Invalid category id');

  // Session.category has no onDelete cascade, so a category with history hits
  // an FK violation that surfaced as an opaque 500. Answer it up front, in a
  // sentence the operator can act on.
  const used = await queryOne('SELECT COUNT(*) AS n FROM sessions WHERE category_id = ?', [id]);
  const sessions = Number(used?.n || 0);
  if (sessions > 0) {
    throw new HttpError(
      409,
      'لا يمكن حذف قسم له جلسات مسجّلة. أوقفه بدلًا من حذفه حتى لا يفقد المستخدمون سجلّهم.',
      { sessions },
      'CATEGORY_IN_USE'
    );
  }

  await prisma.category.delete({ where: { id } });
  res.json({ ok: true });
}));

const questionSchema = z.object({
  categoryId: z.number().int().positive(),
  questionAr: z.string().min(1),
  questionEn: z.string().min(1),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  isActive: z.boolean().default(true),
});

router.get('/questions', requireAdmin(), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const offset = (page - 1) * limit;

  // Filters are ANDed. Without difficulty / isActive / text search, a bank of
  // more than a page of questions is unnavigable from the admin.
  const clauses = [];
  const params = [];

  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;
  if (categoryId && Number.isInteger(categoryId)) {
    clauses.push('q.category_id = ?');
    params.push(categoryId);
  }

  const difficulty = ['easy', 'medium', 'hard'].includes(req.query.difficulty)
    ? req.query.difficulty
    : null;
  if (difficulty) {
    clauses.push('q.difficulty = ?');
    params.push(difficulty);
  }

  if (req.query.isActive === 'true' || req.query.isActive === 'false') {
    clauses.push('q.is_active = ?');
    params.push(req.query.isActive === 'true' ? 1 : 0);
  }

  const search = (req.query.q || '').toString().trim();
  if (search) {
    clauses.push('(q.question_ar LIKE ? OR q.question_en LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const [questions, countRow] = await Promise.all([
    query(
      `SELECT q.id, q.category_id AS categoryId, q.question_ar AS questionAr,
              q.question_en AS questionEn, q.difficulty, q.usage_count AS usageCount,
              q.is_active AS isActive, q.created_at AS createdAt,
              c.name_ar AS categoryNameAr, c.name_en AS categoryNameEn, c.icon AS categoryIcon
       FROM questions q
       JOIN categories c ON c.id = q.category_id
       ${where}
       ORDER BY q.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ),
    queryOne(`SELECT COUNT(*) AS n FROM questions q ${where}`, params),
  ]);
  for (const q of questions) {
    q.isActive = !!q.isActive;
    q.category = { id: q.categoryId, nameAr: q.categoryNameAr, nameEn: q.categoryNameEn, icon: q.categoryIcon };
    delete q.categoryNameAr; delete q.categoryNameEn; delete q.categoryIcon;
  }
  res.json({ questions, page, limit, total: Number(countRow?.n || 0) });
}));

router.post('/questions', requireAdmin('super_admin', 'content_editor'), asyncHandler(async (req, res) => {
  const data = questionSchema.parse(req.body);
  const question = await prisma.question.create({ data });
  res.status(201).json({ question });
}));

router.post('/questions/bulk', requireAdmin('super_admin', 'content_editor'), asyncHandler(async (req, res) => {
  const rows = req.body?.questions;
  if (!Array.isArray(rows)) {
    throw new HttpError(400, 'الحقل questions يجب أن يكون مصفوفة.', undefined, 'BULK_NOT_ARRAY');
  }
  if (rows.length === 0) {
    throw new HttpError(400, 'لا توجد صفوف للاستيراد.', undefined, 'BULK_EMPTY');
  }
  if (rows.length > 500) {
    throw new HttpError(400, 'الحد الأقصى ٥٠٠ سؤال في الدفعة الواحدة.', { max: 500 }, 'BULK_TOO_MANY');
  }

  // z.array(...).parse() rejected the whole batch with one flattened error, so
  // a single bad row was indistinguishable from a malformed file. Validate row
  // by row and report the exact index and field instead.
  const valid = [];
  const rowErrors = [];
  rows.forEach((row, index) => {
    const parsed = questionSchema.safeParse(row);
    if (parsed.success) valid.push({ index, data: parsed.data });
    else {
      rowErrors.push({
        row: index,
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
  });

  // An unknown categoryId is an FK violation at insert time, i.e. an opaque
  // 500 for the whole batch. Resolve it to the rows that caused it.
  if (valid.length > 0) {
    const ids = [...new Set(valid.map((v) => v.data.categoryId))];
    const known = await query(
      `SELECT id FROM categories WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    const knownIds = new Set(known.map((c) => Number(c.id)));
    for (const v of valid) {
      if (!knownIds.has(v.data.categoryId)) {
        rowErrors.push({
          row: v.index,
          issues: [{ path: 'categoryId', message: `القسم رقم ${v.data.categoryId} غير موجود` }],
        });
      }
    }
  }

  // All-or-nothing: a partial import leaves the operator guessing which rows
  // landed.
  if (rowErrors.length > 0) {
    throw new HttpError(
      400,
      `تعذّر الاستيراد: ${rowErrors.length} صف به خطأ. لم يتم حفظ أي سؤال.`,
      { rows: rowErrors.sort((a, b) => a.row - b.row).slice(0, 50), totalInvalid: rowErrors.length },
      'BULK_ROW_ERRORS'
    );
  }

  const result = await prisma.question.createMany({ data: valid.map((v) => v.data) });
  res.status(201).json({ count: result.count });
}));

router.patch('/questions/:id', requireAdmin('super_admin', 'content_editor'), asyncHandler(async (req, res) => {
  const data = questionSchema.partial().parse(req.body);
  const question = await prisma.question.update({ where: { id: BigInt(req.params.id) }, data });
  res.json({ question });
}));

router.delete('/questions/:id', requireAdmin('super_admin', 'content_editor'), asyncHandler(async (req, res) => {
  await prisma.question.delete({ where: { id: BigInt(req.params.id) } });
  res.json({ ok: true });
}));

/* ---------------------------  subscriptions  --------------------------- */

const SUBSCRIPTION_STATUSES = ['pending', 'active', 'expired', 'cancelled', 'refunded'];
const PAYMENT_PROVIDERS = ['easykash', 'paymob', 'google_play', 'manual'];

/**
 * Codes a subscription row may legitimately be labelled with, plus 'manual'.
 *
 * Derived from the live catalogue rather than typed out, so a retired plan
 * disappears from here the moment services/payments/plans.js retires it —
 * 'yearly' is exactly that case: LEGACY_PLANS keeps it resolvable so old rows
 * render a name, and nothing may stamp it on a new one. Packs are excluded
 * because a pack is minutes, not a subscription.
 */
const SUBSCRIPTION_PLAN_CODES = Object.values(PLANS)
  .filter((p) => p.kind === 'subscription')
  .map((p) => p.code);

/**
 * Every load of this route used to throw ER_BAD_FIELD_ERROR: it selected
 * `s.google_purchase_token` and `s.product_id`, which migration 001 renamed to
 * `provider_ref` and `plan_code` (lines 141-142). The admin page had no error
 * branch, so a 500 rendered as a permanently empty grid.
 */
router.get('/subscriptions', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const offset = (page - 1) * limit;
  const q = (req.query.q || '').toString().trim();
  const status = (req.query.status || '').toString().trim();

  const clauses = [];
  const params = [];
  if (q) {
    clauses.push('(u.email LIKE ? OR u.name LIKE ? OR s.provider_ref LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (SUBSCRIPTION_STATUSES.includes(status)) {
    clauses.push('s.status = ?');
    params.push(status);
  }
  // Free-text `q` matches the email, but support arrives holding an id — and a
  // grant made from the user page needs a way to be seen from this one.
  if (req.query.userId) {
    clauses.push('s.user_id = ?');
    params.push(bigId(req.query.userId, 'user id').toString());
  }
  if (req.query.provider) {
    const provider = req.query.provider.toString().trim();
    if (!PAYMENT_PROVIDERS.includes(provider)) {
      throw new HttpError(400, 'مزوّد غير معروف / Unknown provider', undefined, 'UNKNOWN_PROVIDER');
    }
    clauses.push('s.provider = ?');
    params.push(provider);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const [subs, countRow, statusRows, expiringRow] = await Promise.all([
    query(
      `SELECT s.id, s.user_id AS userId, s.provider, s.provider_ref AS providerRef,
              s.plan_code AS planCode, s.status, s.auto_renew AS autoRenew,
              s.started_at AS startedAt, s.expires_at AS expiresAt,
              s.cancelled_at AS cancelledAt, s.created_at AS createdAt,
              u.email AS userEmail, u.name AS userName, u.plan AS userPlan,
              u.premium_until AS userPremiumUntil
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       ${where}
       ORDER BY s.expires_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ),
    queryOne(
      `SELECT COUNT(*) AS n FROM subscriptions s JOIN users u ON u.id = s.user_id ${where}`,
      params
    ),
    // The breakdown is deliberately NOT filtered by status — a "by status"
    // summary that has already been narrowed to one status says nothing.
    query('SELECT status, COUNT(*) AS n FROM subscriptions GROUP BY status'),
    queryOne(
      `SELECT COUNT(*) AS n FROM subscriptions
       WHERE status = 'active' AND expires_at > NOW()
         AND expires_at <= DATE_ADD(NOW(), INTERVAL 7 DAY)`
    ),
  ]);

  for (const s of subs) {
    s.autoRenew = !!s.autoRenew;
    s.user = {
      id: s.userId,
      email: s.userEmail,
      name: s.userName,
      plan: s.userPlan,
      premiumUntil: s.userPremiumUntil,
    };
    delete s.userEmail; delete s.userName; delete s.userPlan; delete s.userPremiumUntil;
  }

  const byStatus = {};
  for (const r of statusRows) byStatus[r.status] = Number(r.n);

  res.json({
    subscriptions: subs,
    page,
    limit,
    total: Number(countRow?.n || 0),
    summary: {
      byStatus,
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      expiringIn7Days: Number(expiringRow?.n || 0),
    },
  });
}));

/**
 * Cancel a subscription.
 *
 * This is NOT a refund and must never be labelled as one: the EasyKash adapter
 * (services/payments/easykash.js) exposes checkout and webhook verification
 * only — there is no refund call to make. No money moves here.
 *
 * The handler this replaces was worse than misnamed. It set plan='free' but
 * left users.premium_until populated, and services/quota.js gates access on
 * premium_until — so a "cancelled" user kept premium until the next sweep. It
 * also never wrote cancelled_at, and it downgraded the user even when another
 * paid subscription still covered them.
 */
async function cancelSubscription(id, { adminId, ip, reason = null, action = 'subscriptions.cancel' }) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.findUnique({
      where: { id },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!sub) {
      throw new HttpError(404, 'الاشتراك غير موجود / Subscription not found', undefined, 'SUBSCRIPTION_NOT_FOUND');
    }

    const subscription = await tx.subscription.update({
      where: { id },
      data: { status: 'cancelled', cancelledAt: sub.cancelledAt ?? now, autoRenew: false },
    });

    // Same rule as services/maintenance.js and the payments webhook: only drop
    // the user to free when no OTHER active subscription still covers them.
    // The row above is already 'cancelled' inside this transaction, so the
    // derivation cannot see it.
    const mirror = await syncPremiumMirror(tx, sub.userId, now);

    // The automatic row records the subscription id and nothing else, so the
    // log could not answer "who lost access, and how much time?".
    await writeAudit(tx, {
      adminId,
      action,
      entityType: 'subscription',
      entityId: id.toString(),
      metadata: {
        userId: sub.userId.toString(),
        userEmail: sub.user?.email ?? null,
        provider: sub.provider,
        planCode: sub.planCode,
        previousStatus: sub.status,
        previousExpiresAt: sub.expiresAt.toISOString(),
        reason,
        // No money moves here — the EasyKash adapter has no refund call.
        moneyMoved: false,
        stillCovered: Boolean(mirror.premiumUntil),
        premiumUntil: mirror.premiumUntil ? mirror.premiumUntil.toISOString() : null,
      },
      ip,
    });

    return {
      subscription,
      stillCovered: Boolean(mirror.premiumUntil),
      user: { id: sub.userId.toString(), plan: mirror.plan, premiumUntil: mirror.premiumUntil },
    };
  });
}

/** `reason` is optional on the cancel paths so the older admin build still works. */
function optionalReason(req) {
  const raw = req.body?.reason;
  return typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 300) : null;
}

router.post('/subscriptions/:id/cancel', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  req.skipAutoAudit = true;
  const result = await cancelSubscription(bigId(req.params.id, 'subscription id'), {
    adminId: req.admin.id, ip: clientIp(req), reason: optionalReason(req),
  });
  res.json({ ok: true, ...result });
}));

/**
 * Revoke. Identical to POST /:id/cancel — the row is cancelled, never deleted:
 * subscriptions are the ledger behind the payments a customer can still see on
 * their statement, and DELETE would destroy the explanation for money already
 * taken. The user's plan and premium_until are re-derived in the same
 * transaction, so access ends the instant this returns.
 */
router.delete('/subscriptions/:id', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  req.skipAutoAudit = true;
  const result = await cancelSubscription(bigId(req.params.id, 'subscription id'), {
    adminId: req.admin.id, ip: clientIp(req), reason: optionalReason(req), action: 'subscriptions.revoke',
  });
  res.json({ ok: true, ...result });
}));

// Deprecated alias kept so an older admin build does not 404. Same behaviour —
// the old path name claimed a gateway refund that never happened.
router.post('/subscriptions/:id/refund', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  req.skipAutoAudit = true;
  const result = await cancelSubscription(bigId(req.params.id, 'subscription id'), {
    adminId: req.admin.id, ip: clientIp(req), reason: optionalReason(req),
  });
  res.json({ ok: true, ...result });
}));

/**
 * Grant premium by hand.
 *
 * The gap this closes: the only manual lever was PATCH /users writing the
 * mirror with no row behind it, invisible on this page and erased by the next
 * expiry sweep. This creates a real provider='manual' subscription and no
 * Payment row, so the customer has verifiable access and revenue reporting
 * stays money-only.
 *
 * `days` EXTENDS from the current expiry when it is still in the future
 * (services/payments/plans.js:computeExpiry, the same function the paid
 * webhook uses), so granting goodwill days to a paying customer adds to what
 * they bought instead of overwriting it — and when a subscription is already
 * covering them, the added days land ON THAT ROW rather than on a manual
 * replacement for it. See extendCoveringSubscription(): superseding a paid row
 * erased where the money came from, and starting a fresh row re-granted a full
 * cycle allowance for a one-day grant.
 *
 * `planCode` therefore applies only when a NEW row is created. It never
 * relabels the row a customer paid for.
 */
const grantSchema = z.object({
  userId: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]),
  // Exactly one of these two. 730 days is the ceiling: a longer "grant" is a
  // typo far more often than it is a decision.
  days: z.number().int().min(1).max(730).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  planCode: z.string().min(1).max(64).optional(),
  // A manual grant with no stated reason is unauditable.
  reason: z.string().min(3).max(300),
});

router.post('/subscriptions', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  const body = grantSchema.parse(req.body);
  const now = new Date();

  if ((body.days === undefined) === (body.expiresAt === undefined)) {
    throw new HttpError(
      400,
      'حدّد عدد الأيام أو تاريخ الانتهاء، وليس كليهما / Supply exactly one of days or expiresAt',
      undefined,
      'GRANT_DURATION_REQUIRED'
    );
  }

  const userId = BigInt(String(body.userId));

  // The user, the disabled flag and the covering row are ALL read inside the
  // transaction, under the same row lock. Read outside it, two agents handling
  // one duplicated ticket both computed +30 days from the same starting expiry
  // and the customer received 30 days while the trail recorded two grants of 30.
  req.skipAutoAudit = true;
  const { subscription, mirror, supersededIds } = await prisma.$transaction(async (tx) => {
    const user = await lockUserRow(tx, userId);
    if (user.isDisabled) {
      throw new HttpError(
        409,
        'الحساب موقوف؛ أعِد تفعيله قبل منح الاشتراك / This account is suspended; re-enable it before granting a subscription',
        undefined,
        'USER_DISABLED'
      );
    }

    const current = await tx.subscription.findFirst({
      where: { userId, status: 'active', expiresAt: { gt: now } },
      orderBy: { expiresAt: 'desc' },
    });

    let expiresAt;
    if (body.days !== undefined) {
      expiresAt = computeExpiry({ currentExpiresAt: current?.expiresAt ?? null, days: body.days, now });
    } else {
      expiresAt = new Date(body.expiresAt);
      if (expiresAt.getTime() <= now.getTime()) {
        throw new HttpError(
          400,
          'تاريخ الانتهاء يجب أن يكون في المستقبل / The expiry date must be in the future',
          undefined,
          'EXPIRY_IN_PAST'
        );
      }
      // An absolute date that lands before the current expiry is a shortening,
      // not a grant. Say so instead of quietly taking away paid days.
      if (current && expiresAt.getTime() < current.expiresAt.getTime()) {
        throw new HttpError(
          409,
          'التاريخ المطلوب أقصر من الاشتراك الحالي؛ استخدم تعديل الاشتراك أو إلغاءه / That date is earlier than the current subscription; use the subscription edit or revoke instead',
          { subscriptionId: current.id.toString(), currentExpiresAt: current.expiresAt.toISOString() },
          'GRANT_SHORTENS_ACCESS'
        );
      }
    }

    // Only ever stamped on a NEW manual row. A duration that matches a
    // catalogue plan is labelled as that plan; anything else is 'manual'.
    // planCode is free text and is NOT what marks a grant as manual —
    // provider='manual' is. A code the catalogue has retired is not accepted:
    // services/payments/plans.js keeps 'yearly' resolvable for history only,
    // and stamping it on a new row re-creates a product that was withdrawn.
    const planCode = body.planCode
      ?? (body.days !== undefined
        ? (Object.values(PLANS).find((p) => p.days === body.days)?.code ?? 'manual')
        : 'manual');
    if (!current && planCode !== 'manual' && !SUBSCRIPTION_PLAN_CODES.includes(planCode)) {
      throw new HttpError(
        400,
        'كود خطة غير معروف أو متوقف؛ اترك الحقل فارغًا ليُسجَّل «يدوي» / Unknown or retired plan code; leave it empty to record the grant as manual',
        { planCode, allowed: [...SUBSCRIPTION_PLAN_CODES, 'manual'] },
        'UNKNOWN_PLAN_CODE'
      );
    }

    return applyManualGrant(tx, {
      user,
      covering: current,
      expiresAt,
      planCode,
      reason: body.reason,
      adminId: req.admin.id,
      ip: clientIp(req),
      via: 'subscriptions.post',
      days: body.days ?? null,
    });
  });

  res.status(201).json({
    subscription,
    supersededIds,
    user: { id: userId.toString(), plan: mirror.plan, premiumUntil: mirror.premiumUntil },
  });
}));

/**
 * Adjust an existing subscription: extend it, correct its expiry, or fix a
 * status that the gateway left wrong.
 *
 * Unlike a grant this never changes `provider` — an EasyKash row extended as
 * goodwill stays EasyKash, because rewriting it to 'manual' would erase where
 * the money came from. The adjustment is appended to raw_payload and recorded
 * in the audit trail instead.
 */
const subscriptionPatchSchema = z.object({
  extendDays: z.number().int().min(1).max(730).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  status: z.enum(SUBSCRIPTION_STATUSES).optional(),
  planCode: z.string().min(1).max(64).optional(),
  autoRenew: z.boolean().optional(),
  reason: z.string().min(3).max(300),
});

router.patch('/subscriptions/:id', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  const body = subscriptionPatchSchema.parse(req.body);
  const id = bigId(req.params.id, 'subscription id');
  const now = new Date();

  if (body.extendDays !== undefined && body.expiresAt !== undefined) {
    throw new HttpError(
      400,
      'حدّد التمديد بالأيام أو تاريخ انتهاء جديدًا، وليس كليهما / Supply either extendDays or expiresAt, not both',
      undefined,
      'EXPIRY_CONFLICT'
    );
  }
  const changesSomething = ['extendDays', 'expiresAt', 'status', 'planCode', 'autoRenew']
    .some((k) => body[k] !== undefined);
  if (!changesSomething) {
    throw new HttpError(400, 'لا يوجد ما يتم تحديثه / Nothing to update', undefined, 'NOTHING_TO_UPDATE');
  }

  const sub = await prisma.subscription.findUnique({
    where: { id },
    include: { user: { select: { id: true, email: true, isDisabled: true } } },
  });
  if (!sub) {
    throw new HttpError(404, 'الاشتراك غير موجود / Subscription not found', undefined, 'SUBSCRIPTION_NOT_FOUND');
  }

  // Correcting a mislabelled row is what this field is for; re-introducing a
  // withdrawn product is not. 'yearly' stays resolvable in LEGACY_PLANS so old
  // rows render a name, and that is the only place it may appear.
  if (
    body.planCode !== undefined
    && body.planCode !== sub.planCode
    && body.planCode !== 'manual'
    && !SUBSCRIPTION_PLAN_CODES.includes(body.planCode)
  ) {
    throw new HttpError(
      400,
      'كود خطة غير معروف أو متوقف / Unknown or retired plan code',
      { planCode: body.planCode, allowed: [...SUBSCRIPTION_PLAN_CODES, 'manual', sub.planCode] },
      'UNKNOWN_PLAN_CODE'
    );
  }

  let expiresAt = sub.expiresAt;
  if (body.extendDays !== undefined) {
    // From the current expiry when it is still ahead, otherwise from now — an
    // extension must never start in the past.
    expiresAt = computeExpiry({ currentExpiresAt: sub.expiresAt, days: body.extendDays, now });
  } else if (body.expiresAt !== undefined) {
    expiresAt = new Date(body.expiresAt);
  }

  const status = body.status ?? sub.status;
  // A row that is active with an expiry in the past is exactly the state the
  // sweep exists to clean up, and it grants nothing. Refuse to create one.
  if (status === 'active' && expiresAt.getTime() <= now.getTime()) {
    throw new HttpError(
      400,
      'اشتراك فعّال يجب أن ينتهي في المستقبل؛ اضبط الحالة على منتهٍ بدلًا من ذلك / An active subscription must expire in the future; set the status to expired instead',
      { expiresAt: expiresAt.toISOString() },
      'EXPIRY_IN_PAST'
    );
  }
  if (status === 'active' && sub.user?.isDisabled) {
    throw new HttpError(
      409,
      'الحساب موقوف؛ أعِد تفعيله أولًا / This account is suspended; re-enable it first',
      undefined,
      'USER_DISABLED'
    );
  }

  const data = { expiresAt, status };
  if (body.planCode !== undefined) data.planCode = body.planCode;
  // auto_renew on anything that is not active is a promise nothing keeps.
  if (body.autoRenew !== undefined) data.autoRenew = status === 'active' ? body.autoRenew : false;
  else if (status !== 'active') data.autoRenew = false;
  if (status === 'cancelled') data.cancelledAt = sub.cancelledAt ?? now;
  if (status === 'active') data.cancelledAt = null;

  req.skipAutoAudit = true;
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.subscription.update({
      where: { id },
      data: {
        ...data,
        rawPayload: JSON.stringify({
          previous: {
            status: sub.status,
            expiresAt: sub.expiresAt.toISOString(),
            planCode: sub.planCode,
            autoRenew: sub.autoRenew,
          },
          adjustedByAdminId: req.admin.id.toString(),
          adjustedAt: now.toISOString(),
          reason: body.reason,
          // Keep the gateway's own payload rather than dropping it — it is the
          // only record of what the provider actually said.
          original: sub.rawPayload ? sub.rawPayload.slice(0, 40000) : null,
        }).slice(0, 60000),
      },
    });

    // Re-activating this row while another still covers the user would leave
    // two active rows and an ambiguous mirror. Supersede the others, exactly as
    // a grant does.
    let supersededIds = [];
    if (status === 'active') {
      const others = await tx.subscription.findMany({
        where: { userId: sub.userId, status: 'active', id: { not: id } },
        select: { id: true },
      });
      if (others.length) {
        await tx.subscription.updateMany({
          where: { id: { in: others.map((o) => o.id) } },
          data: { status: 'expired' },
        });
        supersededIds = others.map((o) => o.id.toString());
      }
    }

    const mirror = await syncPremiumMirror(tx, sub.userId, now);

    await writeAudit(tx, {
      adminId: req.admin.id,
      action: 'subscriptions.update',
      entityType: 'subscription',
      entityId: id.toString(),
      metadata: {
        userId: sub.userId.toString(),
        userEmail: sub.user?.email ?? null,
        provider: sub.provider,
        reason: body.reason,
        extendDays: body.extendDays ?? null,
        from: { status: sub.status, expiresAt: sub.expiresAt.toISOString(), planCode: sub.planCode },
        to: { status, expiresAt: expiresAt.toISOString(), planCode: data.planCode ?? sub.planCode },
        supersededIds,
        premiumUntil: mirror.premiumUntil ? mirror.premiumUntil.toISOString() : null,
      },
      ip: clientIp(req),
    });

    return { subscription: updated, supersededIds, mirror };
  });

  res.json({
    subscription: result.subscription,
    supersededIds: result.supersededIds,
    user: {
      id: sub.userId.toString(),
      plan: result.mirror.plan,
      premiumUntil: result.mirror.premiumUntil,
    },
  });
}));

/* -----------------------------  payments  ------------------------------ */

const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded', 'expired'];

/**
 * A date-only bound means the whole of that day, not the instant of midnight —
 * otherwise `to=2026-08-16` silently excludes everything paid that day.
 *
 * Both bounds are given an explicit time component so both are read in server
 * local time. Bare '2026-08-16' parses as UTC midnight per ES spec while
 * '2026-08-16T23:59:59.999' parses as local, so mixing the two forms would
 * skew the two ends of the range against each other by the UTC offset.
 */
function parseBoundary(raw, endOfDay) {
  const s = (raw || '').toString().trim();
  if (!s) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const d = new Date(dateOnly ? `${s}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Real EasyKash revenue was invisible in the admin: the Payment model and
 * routes/payments.js both exist, but admin.js defined zero payment routes.
 */
router.get('/payments', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const offset = (page - 1) * limit;
  const q = (req.query.q || '').toString().trim();
  const status = (req.query.status || '').toString().trim();
  const from = parseBoundary(req.query.from, false);
  const to = parseBoundary(req.query.to, true);

  // The summary shares the search/date filters but NOT the status filter, so
  // the by-status breakdown stays complete while the list is narrowed.
  const baseClauses = [];
  const baseParams = [];
  if (q) {
    baseClauses.push('(u.email LIKE ? OR u.name LIKE ? OR p.reference LIKE ? OR p.provider_txn_id LIKE ?)');
    baseParams.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (from) { baseClauses.push('p.created_at >= ?'); baseParams.push(from); }
  if (to) { baseClauses.push('p.created_at <= ?'); baseParams.push(to); }

  const listClauses = [...baseClauses];
  const listParams = [...baseParams];
  if (PAYMENT_STATUSES.includes(status)) {
    listClauses.push('p.status = ?');
    listParams.push(status);
  }

  const baseWhere = baseClauses.length ? `WHERE ${baseClauses.join(' AND ')}` : '';
  const listWhere = listClauses.length ? `WHERE ${listClauses.join(' AND ')}` : '';

  const [payments, countRow, statusRows, currencyRows] = await Promise.all([
    query(
      `SELECT p.id, p.user_id AS userId, p.subscription_id AS subscriptionId, p.provider,
              p.reference, p.provider_txn_id AS providerTxnId, p.plan_code AS planCode,
              p.amount_cents AS amountCents, p.currency, p.status, p.method,
              p.failure_reason AS failureReason, p.paid_at AS paidAt,
              p.refunded_at AS refundedAt, p.created_at AS createdAt,
              u.email AS userEmail, u.name AS userName
       FROM payments p
       JOIN users u ON u.id = p.user_id
       ${listWhere}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [...listParams, limit, offset]
    ),
    queryOne(`SELECT COUNT(*) AS n FROM payments p JOIN users u ON u.id = p.user_id ${listWhere}`, listParams),
    query(
      `SELECT p.status, COUNT(*) AS n, COALESCE(SUM(p.amount_cents), 0) AS amountMinor
       FROM payments p JOIN users u ON u.id = p.user_id
       ${baseWhere} GROUP BY p.status`,
      baseParams
    ),
    query(
      `SELECT DISTINCT p.currency FROM payments p JOIN users u ON u.id = p.user_id ${baseWhere}`,
      baseParams
    ),
  ]);

  for (const p of payments) {
    p.amountCents = Number(p.amountCents);
    p.user = { id: p.userId, email: p.userEmail, name: p.userName };
    delete p.userEmail; delete p.userName;
  }

  const byStatus = {};
  for (const r of statusRows) {
    byStatus[r.status] = { count: Number(r.n), amountMinor: Number(r.amountMinor) };
  }
  const paidMinor = byStatus.paid?.amountMinor ?? 0;
  const refundedMinor = byStatus.refunded?.amountMinor ?? 0;

  res.json({
    payments,
    page,
    limit,
    total: Number(countRow?.n || 0),
    summary: {
      byStatus,
      paidMinor,
      paidCount: byStatus.paid?.count ?? 0,
      refundedMinor,
      refundedCount: byStatus.refunded?.count ?? 0,
      // Refunds recorded by the gateway webhook are already excluded from the
      // paid bucket (status moves paid -> refunded), so net is simply paid.
      netMinor: paidMinor,
      // More than one entry means the totals above span currencies and the
      // page must say so rather than adding piastres to cents.
      currencies: currencyRows.map((r) => r.currency),
    },
  });
}));

/* ---------------------------  analytics  ----------------------------
 *
 * The product's day boundary is Africa/Cairo (services/quota.js), so every
 * window below is a range of Cairo calendar days, not UTC ones. The previous
 * code used server-local midnight, which is 2am Cairo in production: "today"
 * on the dashboard disagreed with "today" in the quota the users experience.
 *
 * Ranges are half-open [start, end) so a day never belongs to two buckets.
 */

const APP_TZ = 'Africa/Cairo';
const DAY_MS = 24 * 3600 * 1000;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Offset of Africa/Cairo at a given instant, in minutes. DST-aware — Egypt
 *  reintroduced summer time in 2023, so a fixed +02:00 is wrong half the year. */
function cairoOffsetMinutes(at) {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TZ, timeZoneName: 'longOffset',
  }).format(at);
  const m = formatted.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 120;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

function offsetString(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' for an instant, in Cairo terms. en-CA renders ISO order. */
function cairoYmd(at = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at);
}

/** The UTC instant at which a given Cairo calendar day begins. */
function cairoDayStart(ymd) {
  const utcMidnight = new Date(`${ymd}T00:00:00.000Z`);
  // Second pass settles the case where the offset differs either side of the
  // boundary; no real transition moves a day by more than an hour.
  const first = new Date(utcMidnight.getTime() - cairoOffsetMinutes(utcMidnight) * 60000);
  return new Date(utcMidnight.getTime() - cairoOffsetMinutes(first) * 60000);
}

function addDaysYmd(ymd, n) {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Named time zones in CONVERT_TZ need mysql.time_zone_name to be populated,
 * which shared hosting frequently does not do — and CONVERT_TZ answers NULL
 * rather than erroring, which would silently produce empty buckets. So probe
 * once, and fall back to the offset in force today. The response reports which
 * mode was used so the UI can qualify the numbers instead of overstating them.
 */
let _tzSpec = null;
async function cairoTzSpec() {
  if (_tzSpec) return _tzSpec;
  let named = false;
  try {
    const row = await queryOne("SELECT CONVERT_TZ('2024-06-01 12:00:00','+00:00',?) AS t", [APP_TZ]);
    named = row?.t != null;
  } catch {
    named = false;
  }
  _tzSpec = named
    ? { spec: APP_TZ, exact: true }
    : { spec: offsetString(cairoOffsetMinutes(new Date())), exact: false };
  return _tzSpec;
}

/**
 * `?from=YYYY-MM-DD&to=YYYY-MM-DD`, both inclusive Cairo dates. Also derives
 * the immediately-preceding window of equal length, which is what lets the UI
 * show a real change-vs-previous figure instead of inventing one.
 */
function parseRange(q, { maxDays = 366, defaultDays = 30 } = {}) {
  const to = YMD_RE.test(q.to || '') ? q.to : cairoYmd();
  const from = YMD_RE.test(q.from || '') ? q.from : addDaysYmd(to, -(defaultDays - 1));
  if (from > to) throw new HttpError(400, 'Invalid range: from is after to');

  const start = cairoDayStart(from);
  const end = cairoDayStart(addDaysYmd(to, 1));
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
  if (days > maxDays) throw new HttpError(400, `Range too large (max ${maxDays} days)`);

  return {
    from, to, start, end, days,
    prevStart: cairoDayStart(addDaysYmd(from, -days)),
    prevEnd: start,
  };
}

const num = (v) => Number(v ?? 0);

async function rangeMeta(r) {
  const tz = await cairoTzSpec();
  return {
    from: r.from, to: r.to, days: r.days,
    timezone: APP_TZ,
    /** false ⇒ buckets used a fixed offset; a DST change inside the window
     *  shifts at most one boundary by an hour. */
    exactTimezone: tz.exact,
  };
}

router.get('/analytics/overview', requireAdmin(), asyncHandler(async (req, res) => {
  const r = parseRange(req.query);
  const now = new Date();
  const todayFrom = cairoDayStart(cairoYmd(now));
  const todayTo = new Date(todayFrom.getTime() + DAY_MS);

  // One pass per table, using conditional aggregation for all three windows,
  // rather than fourteen separate COUNT round-trips.
  const [users, sessions, answers] = await Promise.all([
    queryOne(
      `SELECT COUNT(*) AS total,
              SUM(plan = 'premium') AS premiumPlan,
              SUM(plan = 'premium' AND premium_until IS NOT NULL AND premium_until > ?) AS premiumActive,
              SUM(created_at >= ? AND created_at < ?) AS cur,
              SUM(created_at >= ? AND created_at < ?) AS prev,
              SUM(created_at >= ? AND created_at < ?) AS today
       FROM users`,
      [now, r.start, r.end, r.prevStart, r.prevEnd, todayFrom, todayTo]
    ),
    queryOne(
      `SELECT SUM(started_at >= ? AND started_at < ?) AS cur,
              SUM(started_at >= ? AND started_at < ?) AS prev,
              SUM(started_at >= ? AND started_at < ?) AS today,
              COUNT(DISTINCT CASE WHEN started_at >= ? AND started_at < ? THEN user_id END) AS curUsers,
              COUNT(DISTINCT CASE WHEN started_at >= ? AND started_at < ? THEN user_id END) AS prevUsers,
              COUNT(DISTINCT CASE WHEN started_at >= ? AND started_at < ? THEN user_id END) AS todayUsers
       FROM sessions`,
      [r.start, r.end, r.prevStart, r.prevEnd, todayFrom, todayTo,
       r.start, r.end, r.prevStart, r.prevEnd, todayFrom, todayTo]
    ),
    queryOne(
      `SELECT SUM(created_at >= ? AND created_at < ?) AS cur,
              SUM(created_at >= ? AND created_at < ?) AS prev,
              AVG(CASE WHEN created_at >= ? AND created_at < ? THEN ai_score END) AS avgScore,
              COUNT(CASE WHEN created_at >= ? AND created_at < ? THEN ai_score END) AS scored
       FROM answers`,
      [r.start, r.end, r.prevStart, r.prevEnd, r.start, r.end, r.start, r.end]
    ),
  ]);

  // Entitlement, not the `plan` column: services/quota.js gates on
  // premium_until, so a stale 'premium' row is not a paying customer and must
  // not be counted as one.
  const totalUsers = num(users?.total);
  const premiumActive = num(users?.premiumActive);
  const scored = num(answers?.scored);

  res.json({
    range: await rangeMeta(r),
    totals: {
      users: totalUsers,
      premiumUsers: premiumActive,
      /** Rows still flagged 'premium' whose entitlement has lapsed. */
      premiumExpired: Math.max(0, num(users?.premiumPlan) - premiumActive),
      conversionRate: totalUsers ? premiumActive / totalUsers : 0,
    },
    current: {
      newUsers: num(users?.cur),
      sessions: num(sessions?.cur),
      answers: num(answers?.cur),
      activeUsers: num(sessions?.curUsers),
      // No scored answers means no average. Zero would be a fabricated score.
      avgScore: scored ? Number(answers.avgScore) : null,
      scoredAnswers: scored,
    },
    previous: {
      newUsers: num(users?.prev),
      sessions: num(sessions?.prev),
      answers: num(answers?.prev),
      activeUsers: num(sessions?.prevUsers),
    },
    today: {
      date: cairoYmd(now),
      newUsers: num(users?.today),
      sessions: num(sessions?.today),
      activeUsers: num(sessions?.todayUsers),
    },
  });
}));

router.get('/analytics/popular-categories', requireAdmin(), asyncHandler(async (req, res) => {
  const r = parseRange(req.query);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

  // The LEFT JOIN fans rows out, so sessions/users are counted DISTINCT while
  // AVG runs over the fanned answer rows — which is exactly the per-answer mean.
  const rows = await query(
    `SELECT s.category_id AS categoryId, c.name_ar AS nameAr, c.name_en AS nameEn, c.icon,
            c.is_premium AS isPremium,
            COUNT(DISTINCT s.id) AS sessionCount,
            COUNT(DISTINCT s.user_id) AS userCount,
            COUNT(a.id) AS scoredAnswers,
            AVG(a.ai_score) AS avgScore
     FROM sessions s
     JOIN categories c ON c.id = s.category_id
     LEFT JOIN answers a ON a.session_id = s.id AND a.ai_score IS NOT NULL
     WHERE s.started_at >= ? AND s.started_at < ?
     GROUP BY s.category_id, c.name_ar, c.name_en, c.icon, c.is_premium
     ORDER BY sessionCount DESC
     LIMIT ?`,
    [r.start, r.end, limit]
  );

  res.json({
    range: await rangeMeta(r),
    limit,
    rows: rows.map((row) => ({
      category: {
        id: row.categoryId, nameAr: row.nameAr, nameEn: row.nameEn,
        icon: row.icon, isPremium: !!row.isPremium,
      },
      sessions: num(row.sessionCount),
      users: num(row.userCount),
      scoredAnswers: num(row.scoredAnswers),
      avgScore: num(row.scoredAnswers) ? Number(row.avgScore) : null,
    })),
  });
}));

/**
 * Daily buckets over the range, in Cairo days, zero-filled — a day with no
 * activity genuinely is 0 and must plot as 0, not vanish and imply a smooth
 * line through it.
 */
router.get('/analytics/timeseries', requireAdmin(), asyncHandler(async (req, res) => {
  const r = parseRange(req.query, { maxDays: 180 });
  const tz = await cairoTzSpec();
  // DATE_FORMAT, not DATE(): a DATE column comes back as a driver-parsed Date
  // whose own timezone handling would undo the conversion we just did.
  const bucket = (col) => `DATE_FORMAT(CONVERT_TZ(${col}, '+00:00', ?), '%Y-%m-%d')`;

  const [signups, sessions, answers] = await Promise.all([
    query(
      `SELECT ${bucket('created_at')} AS d, COUNT(*) AS n
       FROM users WHERE created_at >= ? AND created_at < ? GROUP BY d`,
      [tz.spec, r.start, r.end]
    ),
    query(
      `SELECT ${bucket('started_at')} AS d, COUNT(*) AS n, COUNT(DISTINCT user_id) AS u
       FROM sessions WHERE started_at >= ? AND started_at < ? GROUP BY d`,
      [tz.spec, r.start, r.end]
    ),
    query(
      `SELECT ${bucket('created_at')} AS d, COUNT(*) AS n,
              AVG(ai_score) AS avgScore, COUNT(ai_score) AS scored
       FROM answers WHERE created_at >= ? AND created_at < ? GROUP BY d`,
      [tz.spec, r.start, r.end]
    ),
  ]);

  const points = new Map();
  for (let i = 0; i < r.days; i += 1) {
    const date = addDaysYmd(r.from, i);
    points.set(date, { date, signups: 0, sessions: 0, activeUsers: 0, answers: 0, avgScore: null });
  }
  for (const row of signups) {
    const p = points.get(row.d); if (p) p.signups = num(row.n);
  }
  for (const row of sessions) {
    const p = points.get(row.d); if (p) { p.sessions = num(row.n); p.activeUsers = num(row.u); }
  }
  for (const row of answers) {
    const p = points.get(row.d);
    if (p) { p.answers = num(row.n); p.avgScore = num(row.scored) ? Number(row.avgScore) : null; }
  }

  res.json({ range: await rangeMeta(r), points: [...points.values()] });
}));

/**
 * The dashboard's "needs your attention" counts. Each field is gated on the
 * same role that owns the page it links to, so the panel can never surface a
 * number the admin is not allowed to act on; absent keys are simply not
 * rendered.
 */
router.get('/analytics/attention', requireAdmin(), asyncHandler(async (req, res) => {
  const { role } = req.admin;
  const now = new Date();
  const attention = {};
  const jobs = [];

  if (role === 'super_admin' || role === 'moderator') {
    jobs.push(
      queryOne('SELECT COUNT(*) AS n FROM answer_reports WHERE resolved = 0')
        .then((row) => { attention.unresolvedReports = num(row?.n); })
    );
  }

  // AI usage is readable by every admin role (see the /ai-usage route).
  jobs.push(
    queryOne(
      'SELECT COUNT(*) AS n FROM claude_api_logs WHERE success = 0 AND created_at >= ?',
      [new Date(now.getTime() - DAY_MS)]
    ).then((row) => { attention.failedAiCalls24h = num(row?.n); })
  );

  if (role === 'super_admin') {
    jobs.push(
      queryOne(
        `SELECT COUNT(*) AS n FROM subscriptions
         WHERE status = 'active' AND expires_at >= ? AND expires_at < ?`,
        [now, new Date(now.getTime() + 7 * DAY_MS)]
      ).then((row) => { attention.expiringSubscriptions7d = num(row?.n); })
    );
  }

  await Promise.all(jobs);
  res.json({ attention, checkedAt: now.toISOString() });
}));

/**
 * The exact per-call cost has been written to `cost_micro_usd` by
 * services/ai/index.js since migration 001; this route simply never selected
 * it, so the admin re-derived a figure from one model's published rates and
 * applied it to Claude, Gemini and Groq alike. It now reports what was
 * actually charged, per provider and per feature.
 *
 * Rows written before the column existed carry a hard 0. A real call always
 * costs more than one micro-USD, so `cost = 0 AND tokens > 0` means "not
 * priced", and it is returned as null (rendered '—') rather than as free.
 */
router.get('/ai-usage', requireAdmin(), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const offset = (page - 1) * limit;

  const days = Math.min(365, Math.max(1, Number(req.query.days) || 7));
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - days * 24 * 3600 * 1000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new HttpError(400, 'Invalid date range');
  }

  const clauses = ['created_at >= ?', 'created_at <= ?'];
  const params = [from, to];

  const provider = (req.query.provider || '').toString().trim();
  if (provider) { clauses.push('provider = ?'); params.push(provider); }

  const feature = (req.query.feature || '').toString().trim();
  if (feature) { clauses.push('feature = ?'); params.push(feature); }

  const status = (req.query.status || '').toString();
  if (status === 'success') clauses.push('success = 1');
  else if (status === 'error') clauses.push('success = 0');

  const where = `WHERE ${clauses.join(' AND ')}`;

  // Egypt is the product's day boundary (services/quota.js). CONVERT_TZ with a
  // numeric offset needs no timezone tables loaded; it ignores DST, which can
  // shift calls in the midnight hour by one day for part of the year.
  const CAIRO_DATE = "DATE(CONVERT_TZ(created_at, '+00:00', '+02:00'))";
  const UNPRICED = '(cost_micro_usd = 0 AND (input_tokens > 0 OR output_tokens > 0))';

  const [logs, countRow, summaryRow, byProvider, byFeature, daily] = await Promise.all([
    query(
      `SELECT id, user_id AS userId, provider, model, feature,
              input_tokens AS inputTokens, output_tokens AS outputTokens,
              cache_read_tokens AS cacheReadTokens, cache_write_tokens AS cacheWriteTokens,
              cost_micro_usd AS costMicroUsd, latency_ms AS latencyMs,
              success, error_message AS errorMessage, created_at AS createdAt
       FROM claude_api_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ),
    queryOne(`SELECT COUNT(*) AS n FROM claude_api_logs ${where}`, params),
    queryOne(
      `SELECT COUNT(*) AS calls,
              SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failures,
              SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens,
              SUM(cache_read_tokens) AS cacheReadTokens, SUM(cache_write_tokens) AS cacheWriteTokens,
              SUM(cost_micro_usd) AS costMicroUsd,
              ROUND(AVG(latency_ms)) AS avgLatencyMs,
              MAX(latency_ms) AS maxLatencyMs,
              SUM(CASE WHEN ${UNPRICED} THEN 1 ELSE 0 END) AS unpricedCalls
       FROM claude_api_logs ${where}`,
      params
    ),
    query(
      `SELECT provider, COUNT(*) AS calls,
              SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failures,
              SUM(cost_micro_usd) AS costMicroUsd,
              SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens,
              SUM(CASE WHEN ${UNPRICED} THEN 1 ELSE 0 END) AS unpricedCalls
       FROM claude_api_logs ${where} GROUP BY provider ORDER BY calls DESC`,
      params
    ),
    query(
      `SELECT feature, COUNT(*) AS calls,
              SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failures,
              SUM(cost_micro_usd) AS costMicroUsd,
              SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens,
              SUM(CASE WHEN ${UNPRICED} THEN 1 ELSE 0 END) AS unpricedCalls
       FROM claude_api_logs ${where} GROUP BY feature ORDER BY calls DESC`,
      params
    ),
    query(
      `SELECT ${CAIRO_DATE} AS day, COUNT(*) AS calls,
              SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failures,
              SUM(cost_micro_usd) AS costMicroUsd,
              SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens
       FROM claude_api_logs ${where} GROUP BY ${CAIRO_DATE} ORDER BY day ASC`,
      params
    ),
  ]);

  for (const l of logs) {
    l.success = !!l.success;
    const unpriced = l.costMicroUsd === 0 && (l.inputTokens > 0 || l.outputTokens > 0);
    l.costMicroUsd = unpriced ? null : Number(l.costMicroUsd);
  }

  const bucket = (r) => ({
    calls: Number(r.calls || 0),
    failures: Number(r.failures || 0),
    costMicroUsd: Number(r.costMicroUsd || 0),
    inputTokens: Number(r.inputTokens || 0),
    outputTokens: Number(r.outputTokens || 0),
    unpricedCalls: Number(r.unpricedCalls || 0),
  });

  res.json({
    logs,
    page,
    limit,
    total: Number(countRow?.n || 0),
    range: { from: from.toISOString(), to: to.toISOString() },
    summary: {
      ...bucket(summaryRow || {}),
      cacheReadTokens: Number(summaryRow?.cacheReadTokens || 0),
      cacheWriteTokens: Number(summaryRow?.cacheWriteTokens || 0),
      avgLatencyMs: summaryRow?.avgLatencyMs === null || summaryRow?.avgLatencyMs === undefined
        ? null
        : Number(summaryRow.avgLatencyMs),
      maxLatencyMs: Number(summaryRow?.maxLatencyMs || 0),
    },
    byProvider: byProvider.map((r) => ({ provider: r.provider, ...bucket(r) })),
    byFeature: byFeature.map((r) => ({ feature: r.feature, ...bucket(r) })),
    daily: daily.map((r) => ({
      // DATE() comes back as a JS Date under this driver config; take the
      // calendar day, not an ISO instant that would re-shift the timezone.
      day: r.day instanceof Date
        ? `${r.day.getUTCFullYear()}-${String(r.day.getUTCMonth() + 1).padStart(2, '0')}-${String(r.day.getUTCDate()).padStart(2, '0')}`
        : String(r.day),
      calls: Number(r.calls || 0),
      failures: Number(r.failures || 0),
      costMicroUsd: Number(r.costMicroUsd || 0),
      inputTokens: Number(r.inputTokens || 0),
      outputTokens: Number(r.outputTokens || 0),
    })),
  });
}));

/* -----------------------  content moderation  ---------------------- */

/**
 * The moderation queue.
 *
 * `answers.question_id` is nullable — live "meeting" answers are free-form and
 * have no row in `questions` — so the old INNER JOIN on `questions` silently
 * dropped every report filed against a meeting answer. A moderator could not
 * see them, could not resolve them, and had no way to know they existed. The
 * join is now LEFT, and the prompt falls back to `answers.question_text`.
 *
 * Read is restricted to the two roles that can act on it: rows carry a user's
 * verbatim answer text, which a content_editor has no reason to read.
 */
router.get('/reports', requireAdmin('super_admin', 'moderator'), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const offset = (page - 1) * limit;

  const clauses = [];
  const params = [];

  // Backed by @@index([resolved, createdAt]).
  const status = (req.query.status || '').toString();
  if (status === 'open') clauses.push('r.resolved = 0');
  else if (status === 'resolved') clauses.push('r.resolved = 1');

  const q = (req.query.q || '').toString().trim();
  if (q) {
    clauses.push('(r.reason LIKE ? OR u.email LIKE ? OR a.user_answer LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const [reports, countRow, openRow] = await Promise.all([
    query(
      `SELECT r.id, r.answer_id AS answerId, r.reporter_id AS reporterId,
              r.reason, r.resolved, r.created_at AS createdAt,
              a.user_answer AS answerText, a.ai_score AS aiScore,
              a.created_at AS answeredAt,
              s.id AS sessionId, s.kind AS sessionKind,
              q.id AS questionId,
              COALESCE(q.question_ar, a.question_text) AS questionText,
              u.email AS reporterEmail, u.name AS reporterName
       FROM answer_reports r
       LEFT JOIN answers a ON a.id = r.answer_id
       LEFT JOIN sessions s ON s.id = a.session_id
       LEFT JOIN questions q ON q.id = a.question_id
       LEFT JOIN users u ON u.id = r.reporter_id
       ${where}
       ORDER BY r.resolved ASC, r.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ),
    queryOne(
      `SELECT COUNT(*) AS n FROM answer_reports r
       LEFT JOIN answers a ON a.id = r.answer_id
       LEFT JOIN users u ON u.id = r.reporter_id ${where}`,
      params
    ),
    queryOne('SELECT COUNT(*) AS n FROM answer_reports WHERE resolved = 0'),
  ]);

  for (const r of reports) {
    r.resolved = !!r.resolved;
    r.answer = {
      id: r.answerId,
      userAnswer: r.answerText,
      aiScore: r.aiScore === null || r.aiScore === undefined ? null : Number(r.aiScore),
      answeredAt: r.answeredAt ?? null,
      sessionId: r.sessionId ?? null,
      sessionKind: r.sessionKind ?? null,
      question: {
        id: r.questionId ?? null,
        text: r.questionText ?? null,
        // Says where the prompt came from, so the COALESCE above cannot be
        // mistaken for a catalogue question that no longer exists.
        source: r.questionId ? 'catalogue' : 'meeting',
      },
    };
    r.reporter = { id: r.reporterId, email: r.reporterEmail, name: r.reporterName };
    delete r.answerText; delete r.answeredAt; delete r.aiScore;
    delete r.sessionId; delete r.sessionKind;
    delete r.questionId; delete r.questionText;
    delete r.reporterEmail; delete r.reporterName;
  }

  res.json({
    reports,
    page,
    limit,
    total: Number(countRow?.n || 0),
    openCount: Number(openRow?.n || 0),
  });
}));

/**
 * Resolve, or reopen. A queue whose only action is irreversible turns a misclick
 * into permanent data loss, so `resolved` is an explicit boolean.
 */
router.post('/reports/:id/resolve', requireAdmin('super_admin', 'moderator'), asyncHandler(async (req, res) => {
  const { resolved } = z.object({ resolved: z.boolean().default(true) }).parse(req.body ?? {});
  const id = bigId(req.params.id, 'report id');

  const existing = await prisma.answerReport.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Report not found');

  const report = await prisma.answerReport.update({ where: { id }, data: { resolved } });
  res.json({ ok: true, report: { id: report.id.toString(), resolved: report.resolved } });
}));

/* ---------------------------  settings  ----------------------------- */

/**
 * `wired` names the keys the backend actually reads at runtime (see
 * services/appSettings.js). The admin UI badges everything else
 * "لا يقرأها التطبيق بعد" rather than letting an operator change a number,
 * see "تم الحفظ", and believe the product changed. Deriving the list from the
 * server means the badge cannot drift from the truth.
 */
router.get('/settings', requireAdmin(), asyncHandler(async (_req, res) => {
  const rows = await query('SELECT `key`, `value`, `updated_at` AS updatedAt FROM app_settings');
  res.json({
    settings: Object.fromEntries(rows.map((r) => [r.key, r.value])),
    updatedAt: Object.fromEntries(rows.map((r) => [r.key, r.updatedAt])),
    wired: Object.keys(WIRED_KEYS),
    // A key the backend used to read and no longer does. Badged "retired" in
    // the UI rather than deleted, so an operator is never shown an editable
    // number that changes nothing — the exact failure appSettings.js exists to
    // prevent, applied to its own history.
    retired: RETIRED_KEYS,
  });
}));

router.put('/settings', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  const body = z.record(
    z.string().min(1).max(100),
    z.string().max(5000),
  ).parse(req.body);

  const entries = Object.entries(body);
  if (entries.length === 0) throw new HttpError(400, 'No settings supplied');
  if (entries.length > 100) throw new HttpError(400, 'Too many settings in one request');

  await Promise.all(entries.map(([key, value]) =>
    prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
  ));

  // Without this the cached copy keeps serving the old value for up to a
  // minute, so the operator saves, reloads, and sees the change "not stick".
  await reloadAppSettings().catch(() => {});

  res.json({ ok: true, wired: Object.keys(WIRED_KEYS), retired: RETIRED_KEYS });
}));

/* -------------------------  integrations  --------------------------- */

/**
 * Provider credentials — EasyKash and the AI providers.
 *
 * Design rules, all load-bearing:
 *  - super_admin only. app_settings is readable by content_editor, which is
 *    why these live in their own table and their own routes.
 *  - No endpoint here ever returns a secret. GET reports isSet / last4 /
 *    source and nothing else; the test endpoint reports an HTTP status class.
 *  - Writes require the admin's password again (step-up). A stolen or
 *    forgotten session must not be enough to swap the payment gateway key.
 *  - The audit row is written in the same transaction as the credential, so a
 *    credential change with no trace cannot exist.
 */

/** Re-authentication for a write. Never distinguishes "no password" from "wrong password". */
async function requireStepUp(req) {
  const password = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const ok = password ? await bcrypt.compare(password, req.admin.passwordHash) : false;
  if (!ok) {
    // 422, deliberately: a 401 would trip the admin app's session interceptor
    // and log the operator out mid-form, and a 403 would toast "ليس لديك
    // صلاحية" for what is really a typo.
    throw new HttpError(422, 'Password confirmation failed', undefined, 'REAUTH_FAILED');
  }
}

function requireCredentialDef(key) {
  const def = credentialDef(key);
  // The registry is an allow-list, not documentation. Without this the route
  // is a "write any config key" primitive.
  if (!def) throw new HttpError(404, 'Unknown credential key', undefined, 'UNKNOWN_CREDENTIAL');
  return def;
}

router.get('/integrations', requireAdmin('super_admin'), asyncHandler(async (_req, res) => {
  res.json({
    credentials: await credentialStatus(),
    // Surfaces "the box cannot decrypt anything" as a first-class state rather
    // than as every row mysteriously reading `unset`.
    cryptoAvailable: isCryptoAvailable(),
  });
}));

router.put('/integrations/:key', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  const def = requireCredentialDef(req.params.key);
  await requireStepUp(req);

  if (!isCryptoAvailable() && def.secret) {
    throw new HttpError(503, 'Credential encryption is unavailable', undefined, 'CRYPTO_UNAVAILABLE');
  }

  // Named so middleware/auditLog.js's redaction regex matches it: if this
  // handler ever stops setting skipAutoAudit, the generic row still cannot
  // capture the plaintext.
  const raw = req.body?.credentialValue;
  let value;
  try {
    value = validateValue(def, raw);
  } catch (err) {
    throw new HttpError(400, err.message, undefined, 'INVALID_CREDENTIAL_VALUE');
  }

  const existing = await queryOne('SELECT `key` FROM provider_credentials WHERE `key` = ?', [def.key]);

  req.skipAutoAudit = true;
  await prisma.$transaction(async (tx) => {
    await writeCredential(tx, { def, value, adminId: req.admin.id });
    await writeAudit(tx, {
      adminId: req.admin.id,
      action: existing ? 'integrations.replace' : 'integrations.set',
      entityType: 'integration',
      entityId: def.key,
      metadata: {
        group: def.group,
        secret: def.secret,
        hadPreviousValue: Boolean(existing),
        // Shape only for secrets. For non-secrets the value IS the answer to
        // "what did they change it to" — and GET /integrations already returns
        // it in the clear, so withholding it here bought no confidentiality and
        // cost the audit trail its content: a redirected EASYKASH_BASE_URL used
        // to leave a row saying a payments setting changed, but not to what.
        ...(def.secret ? {} : { newValue: value.slice(0, 300) }),
      },
      ip: clientIp(req),
    });
  });

  await reloadCredentials().catch(() => {});
  res.json({ ok: true, credentials: await credentialStatus() });
}));

router.delete('/integrations/:key', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  const def = requireCredentialDef(req.params.key);
  await requireStepUp(req);

  const existing = await queryOne('SELECT `key` FROM provider_credentials WHERE `key` = ?', [def.key]);
  if (!existing) throw new HttpError(404, 'No stored value for this key', undefined, 'NOT_STORED');

  req.skipAutoAudit = true;
  await prisma.$transaction(async (tx) => {
    await deleteCredential(tx, def.key);
    await writeAudit(tx, {
      adminId: req.admin.id,
      action: 'integrations.clear',
      entityType: 'integration',
      entityId: def.key,
      metadata: { group: def.group, secret: def.secret, fallsBackToEnv: true },
      ip: clientIp(req),
    });
  });

  await reloadCredentials().catch(() => {});
  res.json({ ok: true, credentials: await credentialStatus() });
}));

/**
 * Test a credential without saving it. The response is derived from the
 * provider's HTTP status only and never contains the value that was tested.
 */
router.post(
  '/integrations/:key/test',
  requireAdmin('super_admin'),
  integrationTestLimiter,
  asyncHandler(async (req, res) => {
    const def = requireCredentialDef(req.params.key);

    const candidateRaw = req.body?.credentialValue;
    let candidate = null;
    if (typeof candidateRaw === 'string' && candidateRaw.trim()) {
      try {
        candidate = validateValue(def, candidateRaw);
      } catch (err) {
        throw new HttpError(400, err.message, undefined, 'INVALID_CREDENTIAL_VALUE');
      }
    }

    const result = await probeCredential(def.key, candidate);

    // Testing is not a mutation; the generic audit row would be noise, and a
    // row per keystroke-driven retry would bury the writes that matter.
    req.skipAutoAudit = true;
    res.json({ key: def.key, checkedAt: new Date().toISOString(), ...result });
  }),
);

/* ------------------------  push notifications  ---------------------- */

/**
 * The operator side of Firebase Cloud Messaging.
 *
 * A broadcast is the only action in this file that cannot be undone, cannot be
 * narrowed after the fact, and is read by people who are not looking at the
 * admin panel: the moment it is accepted it is on tens of thousands of lock
 * screens. A refund can be re-issued and a deleted question can be re-added; a
 * notification that went to every install with a typo in it is permanent.
 * Everything below follows from that.
 *
 *  - super_admin only, and the send itself takes the same step-up as a
 *    credential write. A session left open on an unlocked laptop must not be
 *    enough to address the entire user base.
 *  - "Push is switched off" is a refusal with its own code, never a 200 saying
 *    `sent: 0`. Those two are indistinguishable to an operator, and the second
 *    one teaches them to press send again.
 *  - The same announcement twice in a few minutes is refused, not delivered
 *    twice. The fan-out outlives the browser tab that started it, so "press
 *    send again" is what an operator does to a send that is still running.
 *  - No response here contains the service account. The panel is given the
 *    project id — which already ships inside the APK — and nothing else.
 */

/**
 * Titles and bodies are capped at the column widths from migration 006
 * (VARCHAR(200) / VARCHAR(500)). Rejecting here rather than at INSERT time is
 * the difference between a 400 naming the field and either a 500 from strict
 * MySQL or, with strict mode off, a message silently cut mid-word on every
 * device it reached.
 */
const broadcastSchema = z.object({
  titleAr: z.string().trim().min(1).max(200),
  bodyAr: z.string().trim().min(1).max(500),
  titleEn: z.string().trim().max(200).optional(),
  bodyEn: z.string().trim().max(500).optional(),
  route: z.string().trim().max(64).optional(),
  audience: z.enum(AUDIENCES).default('all'),
  userId: z.union([z.string(), z.number()]).optional(),
});

/**
 * How long an identical broadcast is refused as a repeat.
 *
 * Nothing on the server ever made a send idempotent: there is no idempotency
 * key and no unique key on `notifications` (migration 006 declares a primary
 * key and two non-unique indexes), so every POST inserts a fresh row and fans
 * out again. The only guard was in the browser — a disabled button and a typed
 * confirmation — and neither survives the case that actually happens: the
 * fan-out is a sequential walk in batches (see fcm.sendToTokens) that can run
 * for minutes, the operator's tab or a proxy gives up waiting, and they press
 * إرسال again on a send that is still walking the token table. Everyone it has
 * already reached gets the announcement twice, and this is the one action in
 * this file that cannot be taken back.
 *
 * Five minutes is measured against that failure, not against a deliberate
 * resend: an operator who really does want the same text on the same audience
 * again can send it once the window passes, and the refusal says so.
 */
const BROADCAST_REPEAT_WINDOW_MINUTES = 5;

/**
 * The two ways push can be unavailable, told apart because the repair differs:
 * one needs a service account pasted into /integrations, the other needs the
 * PUSH_ENABLED switch flipped back on. Collapsing them into one "push is off"
 * sends the operator to look in the wrong place.
 */
function requirePushSendable() {
  if (!pushConfigured()) {
    throw new HttpError(
      503, 'Firebase service account is not configured', undefined, 'PUSH_NOT_CONFIGURED',
    );
  }
  if (!pushEnabled()) {
    throw new HttpError(409, 'Push notifications are switched off', undefined, 'PUSH_DISABLED');
  }
}

router.get('/push/overview', requireAdmin('super_admin'), asyncHandler(async (_req, res) => {
  const sa = serviceAccount();
  const [devices, recent] = await Promise.all([
    deviceCounts(),
    query(
      `SELECT n.id, n.title_ar AS titleAr, n.audience, n.kind, n.user_id AS userId,
              n.sent_count AS sentCount, n.failed_count AS failedCount,
              n.created_at AS createdAt
       FROM notifications n
       ORDER BY n.id DESC
       LIMIT 5`
    ),
  ]);

  res.json({
    configured: pushConfigured(),
    enabled: pushEnabled(),
    // The project id and nothing else from the service account. It is already
    // public — it ships in the app's google-services.json — and it is the one
    // field that answers "which Firebase project is this box pointed at" after
    // a rotation. `client_email` and `private_key` are absent by construction,
    // not by redaction, so a future edit cannot reintroduce them by accident.
    projectId: sa?.projectId ?? null,
    devices,
    recent,
  });
}));

/**
 * The send history, keyset-paginated rather than LIMIT/OFFSET like every other
 * list in this file. `notifications` is append-only and read newest-first, so
 * with OFFSET a page-2 request made after a new broadcast landed would re-show
 * the last row of page 1 and hide one entirely. `cursor` is the id of the last
 * row already seen; ids are monotonic, so `id < cursor` is a stable window.
 */
router.get('/push/notifications', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const cursorRaw = (req.query.cursor || '').toString().trim();
  const cursor = cursorRaw ? bigId(cursorRaw, 'cursor').toString() : null;

  const where = cursor ? 'WHERE n.id < ?' : '';
  const params = cursor ? [cursor] : [];

  const [rows, countRow] = await Promise.all([
    query(
      `SELECT n.id, n.title_ar AS titleAr, n.body_ar AS bodyAr,
              n.title_en AS titleEn, n.body_en AS bodyEn, n.route,
              n.audience, n.user_id AS userId, n.kind,
              n.sent_count AS sentCount, n.failed_count AS failedCount,
              n.created_by AS createdBy, n.created_at AS createdAt,
              a.name AS createdByName, a.email AS createdByEmail,
              u.email AS userEmail
       FROM notifications n
       LEFT JOIN admin_users a ON a.id = n.created_by
       LEFT JOIN users u ON u.id = n.user_id
       ${where}
       ORDER BY n.id DESC
       LIMIT ?`,
      // One row past the limit, purely to answer "is there another page"
      // without a second COUNT over the same window.
      [...params, limit + 1]
    ),
    queryOne('SELECT COUNT(*) AS n FROM notifications'),
  ]);

  const hasMore = rows.length > limit;
  const notifications = hasMore ? rows.slice(0, limit) : rows;

  for (const n of notifications) {
    // Automatic notifications have no author. Say the author is unknown rather
    // than rendering a blank name beside a row no human ever touched.
    n.createdByAdmin = n.createdByName || n.createdByEmail
      ? { id: n.createdBy, name: n.createdByName, email: n.createdByEmail }
      : null;
    n.user = n.userId ? { id: n.userId, email: n.userEmail } : null;
    delete n.createdByName; delete n.createdByEmail; delete n.userEmail;
  }

  res.json({
    notifications,
    limit,
    total: Number(countRow?.n || 0),
    nextCursor: hasMore ? String(notifications[notifications.length - 1].id) : null,
  });
}));

router.post('/push/broadcast', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  const body = broadcastSchema.parse(req.body ?? {});

  if (body.audience === 'user' && !body.userId) {
    throw new HttpError(400, 'audience "user" requires a userId', undefined, 'USER_ID_REQUIRED');
  }

  // Half a translation is worse than none: services/push/notify.js falls back
  // to the Arabic copy field by field, so a title in English with no body in
  // English reaches an English reader as a mixed-language notification.
  if (Boolean(body.titleEn) !== Boolean(body.bodyEn)) {
    throw new HttpError(
      400, 'titleEn and bodyEn must be supplied together', undefined, 'INCOMPLETE_TRANSLATION',
    );
  }

  const userId = body.userId ? bigId(body.userId, 'user id') : null;
  if (userId) {
    const target = await queryOne('SELECT id FROM users WHERE id = ?', [userId.toString()]);
    // Without this a mistyped id is a send that reports total 0 and reads as a
    // delivery fault, so the operator retries the same wrong number.
    if (!target) throw new HttpError(404, 'User not found', undefined, 'USER_NOT_FOUND');
  }

  // Both checks run before the step-up on purpose. Being asked to retype a
  // password and only then told that push is switched off is how an operator
  // concludes the password was the problem.
  requirePushSendable();

  // The repeat guard, for the same reason and in the same place: "you already
  // sent this" is the answer the operator needs before being asked for
  // anything else. `notifications` is written by sendNotification() BEFORE the
  // fan-out starts, which is what makes this catch a send that is still in
  // flight and not only one that finished. `notifications_kind_idx` is
  // (kind, created_at), so this is one indexed read over a few rows.
  //
  // It is not a substitute for a unique key: two identical requests that pass
  // this SELECT before either INSERTs still both send. That is a simultaneous
  // double-submit, which the panel's own disabled button already covers; the
  // gap this closes is the human who waits, gives up, and presses send again.
  const repeatUserClause = userId ? 'n.user_id = ?' : 'n.user_id IS NULL';
  const repeatParams = [BROADCAST_REPEAT_WINDOW_MINUTES, body.audience, body.titleAr, body.bodyAr];
  if (userId) repeatParams.push(userId.toString());
  const repeat = await queryOne(
    `SELECT n.id, n.created_at AS createdAt, n.sent_count AS sentCount
       FROM notifications n
      WHERE n.kind = 'manual'
        AND n.created_at >= (NOW(3) - INTERVAL ? MINUTE)
        AND n.audience = ?
        AND n.title_ar = ?
        AND n.body_ar = ?
        AND ${repeatUserClause}
      ORDER BY n.id DESC
      LIMIT 1`,
    repeatParams,
  );
  if (repeat) {
    throw new HttpError(
      409,
      `أُرسل هذا الإشعار نفسه خلال آخر ${BROADCAST_REPEAT_WINDOW_MINUTES} دقائق — راجع السجل قبل إعادة الإرسال`
      + ` / An identical broadcast was sent in the last ${BROADCAST_REPEAT_WINDOW_MINUTES} minutes`,
      // Enough for the history row to be named without a second request: the
      // panel can link to it and say when it went out and how many it reached.
      {
        notificationId: repeat.id === null || repeat.id === undefined ? null : String(repeat.id),
        createdAt: repeat.createdAt,
        sentCount: Number(repeat.sentCount || 0),
      },
      'DUPLICATE_BROADCAST',
    );
  }

  // The step-up this route promises is only as strong as the field that
  // carries it, and the panel sends no such field: BroadcastDrawer's
  // buildBody() puts copy, audience, route and userId in the body and nothing
  // else. Left to requireStepUp() that arrives as REAUTH_FAILED, which
  // admin/src/lib/errors.ts renders as «كلمة المرور غير صحيحة» — a verdict on a
  // password the form never asked for, and one that sends the operator off to
  // reset a credential that was never the problem. Name the missing field
  // instead, with its own code, so the panel can grow the input.
  if (!req.body?.currentPassword) {
    throw new HttpError(
      422,
      'يتطلب إرسال الإشعار تأكيد كلمة مرور حسابك / Password confirmation is required to broadcast',
      undefined,
      'REAUTH_REQUIRED',
    );
  }
  await requireStepUp(req);

  const result = await sendNotification({
    titleAr: body.titleAr,
    bodyAr: body.bodyAr,
    titleEn: body.titleEn || null,
    bodyEn: body.bodyEn || null,
    route: body.route || null,
    audience: body.audience,
    userId,
    kind: 'manual',
    createdBy: req.admin.id,
  });

  // The automatic row would record `push.broadcast` with a null entity id —
  // there is no id in the path — losing the one field that ties "an admin sent
  // a broadcast" to what was actually sent. Same blind spot POST /users and
  // POST /admins work around, handled the same way.
  req.skipAutoAudit = true;
  // logAudit, not writeAudit: the transactional writer exists so an action
  // rolls back when its trail cannot be written, and there is nothing left to
  // roll back here — the messages are already on the devices. Failing the
  // response after a successful send would be a lie, and the operator would
  // send it a second time.
  await logAudit({
    adminId: req.admin.id,
    action: 'push.broadcast',
    entityType: 'notification',
    entityId: result?.id ?? null,
    metadata: {
      audience: body.audience,
      userId: userId ? userId.toString() : null,
      route: body.route || null,
      translated: Boolean(body.titleEn),
      // The title only, as the human-readable handle on "which announcement
      // was this". The body is deliberately not copied: it is already stored
      // verbatim in `notifications` under the id above, and duplicating up to
      // 500 characters into a 4000-character metadata column crowds out the
      // fields that make the row worth keeping — who sent it, to whom, and how
      // it landed. For an audience of one that text is also somebody's private
      // business, and it belongs in exactly one table.
      titleAr: body.titleAr.slice(0, 120),
      total: result?.total ?? 0,
      sent: result?.sent ?? 0,
      failed: result?.failed ?? 0,
      dead: result?.dead ?? 0,
    },
    ip: clientIp(req),
  });

  res.json(result);
}));

/**
 * Prove delivery to one device.
 *
 * Deliberately NOT routed through sendNotification(). That writes a
 * `notifications` row, and that table is both the answer to "did we already
 * announce this" and the source of every user's in-app inbox — a smoke test
 * that turns up in forty thousand inboxes is worse than no smoke test. So this
 * calls FCM directly and leaves no history.
 *
 * The token is optional. With none, it goes to every live device of the user
 * account sharing this admin's email address, which is the only link between
 * an admin row and an app install that exists — admin_users has no user_id.
 *
 * No step-up, unlike the broadcast: this reaches one device the operator names
 * or their own, it is rate-limited, and a delivery check that costs a password
 * is a delivery check nobody runs before the announcement that matters.
 */
router.post(
  '/push/test',
  requireAdmin('super_admin'),
  integrationTestLimiter,
  asyncHandler(async (req, res) => {
    const body = z.object({
      titleAr: z.string().trim().min(1).max(200).default('اختبار الإشعارات'),
      bodyAr: z.string().trim().min(1).max(500).default('رسالة تجريبية من لوحة التحكم.'),
      token: z.string().trim().min(10).max(255).optional(),
    }).parse(req.body ?? {});

    requirePushSendable();

    let tokens;
    if (body.token) {
      tokens = [body.token];
    } else {
      const linked = await queryOne('SELECT id FROM users WHERE email = ?', [req.admin.email]);
      if (!linked) {
        throw new HttpError(
          400,
          'Supply a device token, or sign into the app with this admin email first',
          undefined,
          'NO_TEST_TARGET',
        );
      }
      const rows = await tokensForAudience('user', { userId: bigId(linked.id, 'user id') });
      tokens = rows.map((r) => r.token);
    }

    if (!tokens.length) {
      // Distinct from "sent 0 of 0": nothing is wrong with the credential, the
      // device simply never registered a token.
      throw new HttpError(409, 'No live device token to send to', undefined, 'NO_DEVICE_TOKEN');
    }

    const result = await sendToTokens(
      tokens,
      buildMessage({
        title: body.titleAr,
        body: body.bodyAr,
        // No `route`. There is no notifications screen in the app —
        // RootStackParamList has no such key, the client's deep-link handler
        // ignores any name outside its two allow-lists
        // (mobile/src/push/usePushNotifications.ts), and services/push/notify.js
        // keeps the same allow-list and would have dropped it. A name invented
        // here makes the one notification an operator sends to prove the
        // pipeline works the one whose tap does nothing, which is exactly the
        // symptom they are testing for. With no route the tap opens the app,
        // which is all a delivery check has to prove.
        //
        // `test` and not 'admin_test': that is the kind the panel's KIND_LABEL_AR
        // already names (admin/src/features/push/api.ts), and one vocabulary for
        // this notification is worth more than none.
        data: { kind: 'test' },
      }),
      // A token FCM rejects as dead during a test is retired here too.
      // Otherwise the operator's own stale token fails every future test and
      // reads as a broken service account.
      retireToken,
    );

    // The automatic audit row is kept here, unlike POST /integrations/:key/test
    // which skips it. That one only asks a provider whether a string is valid;
    // this one delivers a real notification to a device the caller chose, so it
    // must leave a trace. The token in the body is redacted by the middleware's
    // own key regex before the row is written.
    res.json({ ok: result.sent > 0, ...result });
  }),
);

/* -----------------------  admin users (RBAC)  --------------------- */

const ADMIN_ROLES = ['super_admin', 'moderator', 'content_editor'];

router.get('/admins', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const offset = (page - 1) * limit;

  const [admins, countRow] = await Promise.all([
    query(
      `SELECT id, email, name, role, is_active AS isActive,
              last_login_at AS lastLoginAt, created_at AS createdAt
       FROM admin_users ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    ),
    queryOne('SELECT COUNT(*) AS n FROM admin_users'),
  ]);
  for (const a of admins) a.isActive = !!a.isActive;
  res.json({ admins, page, limit, total: Number(countRow?.n || 0) });
}));

router.post('/admins', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  const schema = z.object({
    email: z.string().email().toLowerCase(),
    password: z.string().min(8).max(200),
    name: z.string().min(2).max(120),
    role: z.enum(ADMIN_ROLES).default('moderator'),
  });
  const body = schema.parse(req.body);
  const passwordHash = await bcrypt.hash(body.password, 12);

  // Same entity_id blind spot as POST /users: there is no id in the path, so
  // the automatic row would record that an admin account was created without
  // saying which one — for the route that hands out privileges.
  req.skipAutoAudit = true;
  const admin = await prisma.$transaction(async (tx) => {
    const created = await tx.adminUser.create({
      data: { email: body.email, passwordHash, name: body.name, role: body.role },
    });
    await writeAudit(tx, {
      adminId: req.admin.id,
      action: 'admins.create',
      entityType: 'admin',
      entityId: created.id.toString(),
      metadata: { email: created.email, name: created.name, role: created.role },
      ip: clientIp(req),
    });
    return created;
  });

  const { passwordHash: _ph, ...rest } = admin;
  res.status(201).json({ admin: rest });
}));

/**
 * Guards shared by PATCH and DELETE. requireAdmin() already refuses a
 * deactivated admin (middleware/auth.js), but nothing could deactivate one —
 * and nothing stopped the only super admin from locking everyone out.
 */
async function assertAdminMutable(target, actorId, { losingSuperAdmin, deleting }) {
  if (target.id === actorId) {
    throw new HttpError(
      400,
      deleting ? 'You cannot delete your own account' : 'You cannot change your own role or status',
      undefined,
      'ADMIN_SELF_ACTION'
    );
  }
  if (losingSuperAdmin && target.role === 'super_admin') {
    const others = await prisma.adminUser.count({
      where: { role: 'super_admin', isActive: true, id: { not: target.id } },
    });
    if (others === 0) {
      throw new HttpError(
        409,
        'The last active super admin cannot be demoted, deactivated or deleted',
        undefined,
        'LAST_SUPER_ADMIN'
      );
    }
  }
}

router.patch('/admins/:id', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  const schema = z.object({
    name: z.string().min(2).max(120).optional(),
    role: z.enum(ADMIN_ROLES).optional(),
    isActive: z.boolean().optional(),
    // Optional password reset in the same call — an admin who lost their
    // password previously had no recovery path at all.
    password: z.string().min(8).max(200).optional(),
  });
  const body = schema.parse(req.body);
  const id = bigId(req.params.id, 'admin id');

  const target = await prisma.adminUser.findUnique({ where: { id } });
  if (!target) throw new HttpError(404, 'Admin not found');

  const changesRole = body.role !== undefined && body.role !== target.role;
  const changesStatus = body.isActive !== undefined && body.isActive !== target.isActive;
  if (changesRole || changesStatus) {
    await assertAdminMutable(target, req.admin.id, {
      losingSuperAdmin: (changesRole && body.role !== 'super_admin') || body.isActive === false,
      deleting: false,
    });
  }

  const data = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.role !== undefined) data.role = body.role;
  if (body.isActive !== undefined) data.isActive = body.isActive;
  if (body.password !== undefined) data.passwordHash = await bcrypt.hash(body.password, 12);
  if (Object.keys(data).length === 0) throw new HttpError(400, 'Nothing to update');

  // A ROLE CHANGE USES THE TRANSACTIONAL WRITER, as services/audit.js and
  // middleware/auditLog.js both say it does. Left to the derived row, a
  // privilege escalation was recorded as metadata={"role":"super_admin"} with
  // no previous role, no target account and no way to tell it from a re-save —
  // and because that writer swallows its own errors behind a 1500 ms timeout,
  // the escalation could return 200 with no trace at all. Here the audit insert
  // is part of the same transaction: if it fails, the promotion rolls back.
  req.skipAutoAudit = true;
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.adminUser.update({ where: { id }, data });
    await writeAudit(tx, {
      adminId: req.admin.id,
      action: 'admins.update',
      entityType: 'admin',
      entityId: id.toString(),
      metadata: {
        targetEmail: target.email,
        targetName: target.name,
        from: { role: target.role, isActive: target.isActive },
        to: { role: row.role, isActive: row.isActive },
        roleChanged: changesRole,
        statusChanged: changesStatus,
        nameChanged: body.name !== undefined && body.name !== target.name,
        // The value never appears — the FACT does. Redaction alone left no
        // record that a password had been reset at all.
        passwordReset: body.password !== undefined,
      },
      ip: clientIp(req),
    });
    return row;
  });

  const { passwordHash: _ph, ...rest } = updated;
  res.json({ admin: rest });
}));

/**
 * Delete an admin account — and REFUSE to when it has an audit trail.
 *
 * `AdminAuditLog.admin` is onDelete: Cascade (prisma/schema.prisma:510), so
 * this statement used to delete every audit row that admin had ever written.
 * That is the exact opposite of what the trail is for: the credential and
 * subscription writes go through the transactional writer specifically so that
 * "a credential change with no trace cannot exist" — and one DELETE on the
 * author's account erased all of them, leaving a single derived row
 * `admins.delete / admin / 7` that does not even name the account.
 *
 * Deactivation is the operation that was actually wanted: requireAdmin()
 * refuses an inactive admin at the door (middleware/auth.js), so the account
 * can do nothing, while the row survives to keep naming the author of every
 * action it took. Deleting stays possible only for an account that never acted.
 */
router.delete('/admins/:id', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  const id = bigId(req.params.id, 'admin id');
  const target = await prisma.adminUser.findUnique({ where: { id } });
  if (!target) throw new HttpError(404, 'Admin not found');

  await assertAdminMutable(target, req.admin.id, { losingSuperAdmin: true, deleting: true });

  const auditRows = await prisma.adminAuditLog.count({ where: { adminId: id } });
  if (auditRows > 0) {
    throw new HttpError(
      409,
      'لهذا الحساب سجل عمليات لا يجوز حذفه؛ عطّل الحساب بدلًا من حذفه / This account has an audit trail that must be retained; deactivate it instead of deleting it',
      { auditRows, email: target.email },
      'ADMIN_HAS_AUDIT_TRAIL'
    );
  }

  req.skipAutoAudit = true;
  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, {
      adminId: req.admin.id,
      action: 'admins.delete',
      entityType: 'admin',
      entityId: id.toString(),
      // Names the account being destroyed: after the delete, nothing else can.
      metadata: {
        email: target.email,
        name: target.name,
        role: target.role,
        isActive: target.isActive,
        lastLoginAt: target.lastLoginAt ? target.lastLoginAt.toISOString() : null,
        auditRows: 0,
      },
      ip: clientIp(req),
    });
    await tx.adminUser.delete({ where: { id } });
  });
  res.json({ ok: true });
}));

/* ---------------------------  audit log  ---------------------------- */

/**
 * The accountability surface for everything above. `admin_audit_logs` is
 * written by middleware/auditLog.js on every successful admin mutation, and by
 * services/audit.js transactionally where losing the trail is unacceptable.
 *
 * Facets are derived from the rows actually present rather than hardcoded, so
 * the filters cannot drift out of step with the actions being recorded.
 */
router.get('/audit', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const offset = (page - 1) * limit;

  const clauses = [];
  const params = [];

  const action = (req.query.action || '').toString().trim();
  if (action) { clauses.push('l.action = ?'); params.push(action); }

  const entityType = (req.query.entityType || '').toString().trim();
  if (entityType) { clauses.push('l.entity_type = ?'); params.push(entityType); }

  const adminId = (req.query.adminId || '').toString().trim();
  if (adminId) {
    clauses.push('l.admin_id = ?');
    params.push(bigId(adminId, 'admin id').toString());
  }

  if (req.query.from) {
    const from = new Date(String(req.query.from));
    if (Number.isNaN(from.getTime())) throw new HttpError(400, 'Invalid from date');
    clauses.push('l.created_at >= ?');
    params.push(from);
  }
  if (req.query.to) {
    const to = new Date(String(req.query.to));
    if (Number.isNaN(to.getTime())) throw new HttpError(400, 'Invalid to date');
    clauses.push('l.created_at <= ?');
    params.push(to);
  }

  const q = (req.query.q || '').toString().trim();
  if (q) {
    clauses.push('(l.entity_id LIKE ? OR l.ip LIKE ? OR a.email LIKE ? OR a.name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const [logs, countRow, actions, entityTypes, admins] = await Promise.all([
    query(
      `SELECT l.id, l.admin_id AS adminId, l.action, l.entity_type AS entityType,
              l.entity_id AS entityId, l.metadata, l.ip, l.created_at AS createdAt,
              a.name AS adminName, a.email AS adminEmail, a.role AS adminRole
       FROM admin_audit_logs l
       LEFT JOIN admin_users a ON a.id = l.admin_id
       ${where}
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ),
    queryOne(
      `SELECT COUNT(*) AS n FROM admin_audit_logs l
       LEFT JOIN admin_users a ON a.id = l.admin_id ${where}`,
      params
    ),
    query('SELECT DISTINCT action FROM admin_audit_logs ORDER BY action ASC'),
    query('SELECT DISTINCT entity_type AS entityType FROM admin_audit_logs ORDER BY entity_type ASC'),
    query(
      `SELECT DISTINCT l.admin_id AS id, a.name, a.email
       FROM admin_audit_logs l
       LEFT JOIN admin_users a ON a.id = l.admin_id
       ORDER BY a.name ASC`
    ),
  ]);

  for (const l of logs) {
    // An author can only be missing on rows written before DELETE /admins/:id
    // started refusing to delete an account that has a trail (the FK is
    // ON DELETE CASCADE, so a delete used to take the rows with it). Say the
    // author is unknown rather than rendering a blank one.
    l.admin = l.adminName || l.adminEmail
      ? { id: l.adminId, name: l.adminName, email: l.adminEmail, role: l.adminRole }
      : null;
    delete l.adminName; delete l.adminEmail; delete l.adminRole;
  }

  res.json({
    logs,
    page,
    limit,
    total: Number(countRow?.n || 0),
    facets: {
      actions: actions.map((r) => r.action),
      entityTypes: entityTypes.map((r) => r.entityType),
      admins: admins
        .filter((r) => r.id !== null && r.id !== undefined)
        .map((r) => ({ id: String(r.id), name: r.name, email: r.email })),
    },
  });
}));

export default router;
