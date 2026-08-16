import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { prisma } from '../db/prisma.js';
import { query, queryOne } from '../db/mysql.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { requireAdmin, signAdminToken } from '../middleware/auth.js';
import { auditAdminMutations } from '../middleware/auditLog.js';
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

router.patch('/users/:id', requireAdmin('super_admin', 'moderator'), asyncHandler(async (req, res) => {
  const schema = z.object({
    plan: z.enum(['free', 'premium']).optional(),
    isDisabled: z.boolean().optional(),
    name: z.string().min(2).max(120).optional(),
    // ISO-8601. Accepting this is what makes the "grant premium" control real:
    // services/quota.js:hasPremium() requires premiumUntil > now, so writing
    // plan alone grants nothing and reverts on the next subscription sweep.
    premiumUntil: z.union([z.string().datetime(), z.null()]).optional(),
  });
  const body = schema.parse(req.body);

  const data = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.isDisabled !== undefined) data.isDisabled = body.isDisabled;
  if (body.plan !== undefined) data.plan = body.plan;
  if (body.premiumUntil !== undefined) {
    data.premiumUntil = body.premiumUntil ? new Date(body.premiumUntil) : null;
  }

  if (data.plan === 'premium') {
    const until = data.premiumUntil;
    if (!until || until.getTime() <= Date.now()) {
      throw new HttpError(
        400,
        'Granting premium requires premiumUntil in the future',
        undefined,
        'PREMIUM_UNTIL_REQUIRED'
      );
    }
  }
  // Downgrading must clear the expiry too, or hasPremium() keeps returning
  // true off a stale date the moment plan flips back.
  if (data.plan === 'free') data.premiumUntil = null;

  const user = await prisma.user.update({ where: { id: bigId(req.params.id, 'user id') }, data });
  res.json({ user });
}));

router.delete('/users/:id', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  try {
    await prisma.user.delete({ where: { id: bigId(req.params.id, 'user id') } });
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
async function cancelSubscription(id) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { id } });
    if (!sub) throw new HttpError(404, 'Subscription not found');

    const subscription = await tx.subscription.update({
      where: { id },
      data: { status: 'cancelled', cancelledAt: sub.cancelledAt ?? now, autoRenew: false },
    });

    // Same rule as services/maintenance.js and the payments webhook: only drop
    // the user to free when no OTHER active subscription still covers them.
    const stillCovered = await tx.subscription.findFirst({
      where: { userId: sub.userId, status: 'active', expiresAt: { gt: now }, id: { not: sub.id } },
      orderBy: { expiresAt: 'desc' },
      select: { expiresAt: true },
    });

    await tx.user.update({
      where: { id: sub.userId },
      data: stillCovered
        ? { plan: 'premium', premiumUntil: stillCovered.expiresAt }
        : { plan: 'free', premiumUntil: null },
    });

    return { subscription, stillCovered: Boolean(stillCovered) };
  });
}

router.post('/subscriptions/:id/cancel', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  res.json({ ok: true, ...(await cancelSubscription(bigId(req.params.id, 'subscription id'))) });
}));

// Deprecated alias kept so an older admin build does not 404. Same behaviour —
// the old path name claimed a gateway refund that never happened.
router.post('/subscriptions/:id/refund', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  res.json({ ok: true, ...(await cancelSubscription(bigId(req.params.id, 'subscription id'))) });
}));

/* -----------------------------  payments  ------------------------------ */

const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded', 'expired'];

/** Date-only input means the whole day in the operator's terms, not midnight. */
function parseBoundary(raw, endOfDay) {
  const s = (raw || '').toString().trim();
  if (!s) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const d = new Date(dateOnly && endOfDay ? `${s}T23:59:59.999` : s);
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

router.get('/settings', requireAdmin(), asyncHandler(async (_req, res) => {
  const rows = await query('SELECT `key`, `value` FROM app_settings');
  res.json({ settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
}));

router.put('/settings', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  const body = z.record(z.string(), z.string()).parse(req.body);
  const entries = Object.entries(body);
  await Promise.all(entries.map(([key, value]) =>
    prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
  ));
  res.json({ ok: true });
}));

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
  const admin = await prisma.adminUser.create({
    data: { email: body.email, passwordHash, name: body.name, role: body.role },
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

  const updated = await prisma.adminUser.update({ where: { id }, data });
  const { passwordHash: _ph, ...rest } = updated;
  res.json({ admin: rest });
}));

router.delete('/admins/:id', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  const id = bigId(req.params.id, 'admin id');
  const target = await prisma.adminUser.findUnique({ where: { id } });
  if (!target) throw new HttpError(404, 'Admin not found');

  await assertAdminMutable(target, req.admin.id, { losingSuperAdmin: true, deleting: true });

  await prisma.adminUser.delete({ where: { id } });
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
    // The admin row is gone once the account is deleted (ON DELETE CASCADE
    // removes their rows, but a re-pointed id would still read null): say so
    // rather than rendering a blank author.
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
