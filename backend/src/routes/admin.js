import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { prisma } from '../db/prisma.js';
import { query, queryOne } from '../db/mysql.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { requireAdmin, signAdminToken } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';

const router = Router();

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
  await prisma.user.delete({ where: { id: bigId(req.params.id, 'user id') } });
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
  res.json({ ok: true, ...(await cancelSubscription(BigInt(req.params.id))) });
}));

// Deprecated alias kept so an older admin build does not 404. Same behaviour —
// the old path name claimed a gateway refund that never happened.
router.post('/subscriptions/:id/refund', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  res.json({ ok: true, ...(await cancelSubscription(BigInt(req.params.id))) });
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

/* ---------------------------  analytics  ---------------------------- */

router.get('/analytics/overview', requireAdmin(), asyncHandler(async (_req, res) => {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const [
    { n: totalUsers },
    { n: premiumUsers },
    { n: newUsers30d },
    { n: sessionsToday },
    { n: answers30d },
    { n: activeToday },
  ] = await Promise.all([
    queryOne('SELECT COUNT(*) AS n FROM users'),
    queryOne('SELECT COUNT(*) AS n FROM users WHERE plan = "premium"'),
    queryOne('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', [since]),
    queryOne('SELECT COUNT(*) AS n FROM sessions WHERE started_at >= ?', [today]),
    queryOne('SELECT COUNT(*) AS n FROM answers WHERE created_at >= ?', [since]),
    queryOne('SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE started_at >= ?', [today]),
  ]);

  res.json({
    totalUsers: Number(totalUsers), activeToday: Number(activeToday),
    premiumUsers: Number(premiumUsers), newUsers30d: Number(newUsers30d),
    sessionsToday: Number(sessionsToday), answers30d: Number(answers30d),
    conversionRate: Number(totalUsers) ? (Number(premiumUsers) / Number(totalUsers)) : 0,
  });
}));

router.get('/analytics/popular-categories', requireAdmin(), asyncHandler(async (_req, res) => {
  const rows = await query(
    `SELECT s.category_id AS categoryId, c.name_ar AS nameAr, c.name_en AS nameEn, c.icon,
            c.is_premium AS isPremium, COUNT(*) AS sessionCount
     FROM sessions s
     JOIN categories c ON c.id = s.category_id
     GROUP BY s.category_id, c.name_ar, c.name_en, c.icon, c.is_premium
     ORDER BY sessionCount DESC LIMIT 20`
  );
  res.json({
    rows: rows.map((r) => ({
      category: { id: r.categoryId, nameAr: r.nameAr, nameEn: r.nameEn, icon: r.icon, isPremium: !!r.isPremium },
      sessions: Number(r.sessionCount),
    })),
  });
}));

router.get('/ai-usage', requireAdmin(), asyncHandler(async (_req, res) => {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [logs, summary] = await Promise.all([
    query(
      `SELECT id, user_id AS userId, model, input_tokens AS inputTokens,
              output_tokens AS outputTokens, latency_ms AS latencyMs,
              success, error_message AS errorMessage, created_at AS createdAt
       FROM claude_api_logs WHERE created_at >= ? ORDER BY created_at DESC LIMIT 500`,
      [since]
    ),
    queryOne(
      `SELECT COUNT(*) AS n, SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens
       FROM claude_api_logs WHERE created_at >= ?`,
      [since]
    ),
  ]);
  for (const l of logs) l.success = !!l.success;
  res.json({
    logs,
    summary: {
      _count: { _all: Number(summary?.n || 0) },
      _sum: {
        inputTokens: Number(summary?.inputTokens || 0),
        outputTokens: Number(summary?.outputTokens || 0),
      },
    },
  });
}));

/* -----------------------  content moderation  ---------------------- */

router.get('/reports', requireAdmin(), asyncHandler(async (_req, res) => {
  const reports = await query(
    `SELECT r.id, r.answer_id AS answerId, r.reporter_id AS reporterId,
            r.reason, r.resolved, r.created_at AS createdAt,
            a.user_answer AS answerText, a.ai_score AS aiScore,
            q.id AS questionId, q.question_ar AS questionAr,
            u.email AS reporterEmail
     FROM answer_reports r
     JOIN answers a ON a.id = r.answer_id
     JOIN questions q ON q.id = a.question_id
     JOIN users u ON u.id = r.reporter_id
     ORDER BY r.created_at DESC LIMIT 100`
  );
  for (const r of reports) {
    r.resolved = !!r.resolved;
    r.answer = {
      id: r.answerId, userAnswer: r.answerText, aiScore: r.aiScore,
      question: { id: r.questionId, questionAr: r.questionAr },
    };
    r.reporter = { id: r.reporterId, email: r.reporterEmail };
    delete r.answerText; delete r.questionId; delete r.questionAr; delete r.reporterEmail; delete r.aiScore;
  }
  res.json({ reports });
}));

router.post('/reports/:id/resolve', requireAdmin('super_admin', 'moderator'), asyncHandler(async (req, res) => {
  await prisma.answerReport.update({
    where: { id: BigInt(req.params.id) },
    data: { resolved: true },
  });
  res.json({ ok: true });
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

router.get('/admins', requireAdmin('super_admin'), asyncHandler(async (_req, res) => {
  const admins = await query(
    `SELECT id, email, name, role, is_active AS isActive, created_at AS createdAt
     FROM admin_users ORDER BY created_at DESC`
  );
  for (const a of admins) a.isActive = !!a.isActive;
  res.json({ admins });
}));

router.post('/admins', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  const schema = z.object({
    email: z.string().email().toLowerCase(),
    password: z.string().min(8),
    name: z.string().min(2),
    role: z.enum(['super_admin', 'moderator', 'content_editor']).default('moderator'),
  });
  const body = schema.parse(req.body);
  const passwordHash = await bcrypt.hash(body.password, 12);
  const admin = await prisma.adminUser.create({
    data: { email: body.email, passwordHash, name: body.name, role: body.role },
  });
  const { passwordHash: _ph, ...rest } = admin;
  res.status(201).json({ admin: rest });
}));

export default router;
