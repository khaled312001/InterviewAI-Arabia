import { Router } from 'express';
import bcrypt from 'bcrypt';
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

router.post('/auth/login', authLimiter, asyncHandler(async (req, res) => {
  const body = loginSchema.parse(req.body);
  const admin = await prisma.adminUser.findUnique({ where: { email: body.email } });
  if (!admin || !admin.isActive) throw new HttpError(401, 'Invalid credentials');
  const ok = await bcrypt.compare(body.password, admin.passwordHash);
  if (!ok) throw new HttpError(401, 'Invalid credentials');
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

  const where = q ? 'WHERE email LIKE ? OR name LIKE ?' : '';
  const params = q ? [`%${q}%`, `%${q}%`] : [];

  const [users, countRow] = await Promise.all([
    query(
      `SELECT id, email, name, language, plan, daily_questions_used AS dailyQuestionsUsed,
              last_reset_date AS lastResetDate, is_disabled AS isDisabled,
              created_at AS createdAt
       FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ),
    queryOne(`SELECT COUNT(*) AS n FROM users ${where}`, params),
  ]);
  // Normalize 0/1 ints to booleans (matches Prisma's output shape).
  for (const u of users) u.isDisabled = !!u.isDisabled;
  res.json({ users, page, limit, total: Number(countRow?.n || 0) });
}));

router.patch('/users/:id', requireAdmin('super_admin', 'moderator'), asyncHandler(async (req, res) => {
  const schema = z.object({
    plan: z.enum(['free', 'premium']).optional(),
    isDisabled: z.boolean().optional(),
    name: z.string().min(2).max(120).optional(),
  });
  const data = schema.parse(req.body);
  const user = await prisma.user.update({ where: { id: BigInt(req.params.id) }, data });
  res.json({ user });
}));

router.delete('/users/:id', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  await prisma.user.delete({ where: { id: BigInt(req.params.id) } });
  res.json({ ok: true });
}));

router.get('/users/:id/sessions', requireAdmin(), asyncHandler(async (req, res) => {
  const userId = req.params.id;
  const sessions = await query(
    `SELECT s.id, s.total_score AS totalScore, s.started_at AS startedAt, s.ended_at AS endedAt,
            s.category_id AS categoryId,
            c.name_ar AS categoryNameAr, c.name_en AS categoryNameEn, c.icon AS categoryIcon,
            (SELECT COUNT(*) FROM answers a WHERE a.session_id = s.id) AS answersCount
     FROM sessions s
     JOIN categories c ON c.id = s.category_id
     WHERE s.user_id = ?
     ORDER BY s.started_at DESC LIMIT 100`,
    [userId]
  );
  for (const s of sessions) {
    s.category = { id: s.categoryId, nameAr: s.categoryNameAr, nameEn: s.categoryNameEn, icon: s.categoryIcon };
    delete s.categoryNameAr; delete s.categoryNameEn; delete s.categoryIcon;
    s._count = { answers: Number(s.answersCount) };
    delete s.answersCount;
  }
  res.json({ sessions });
}));

/* ---------------------  categories + questions  ----------------------- */

const categorySchema = z.object({
  nameAr: z.string().min(1),
  nameEn: z.string().min(1),
  icon: z.string().optional(),
  isPremium: z.boolean().default(false),
  sortOrder: z.number().int().optional(),
});

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
  await prisma.category.delete({ where: { id: Number(req.params.id) } });
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
  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;

  const where = categoryId ? 'WHERE q.category_id = ?' : '';
  const params = categoryId ? [categoryId] : [];

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
  const arr = z.array(questionSchema).max(500).parse(req.body?.questions);
  const result = await prisma.question.createMany({ data: arr });
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

router.get('/subscriptions', requireAdmin(), asyncHandler(async (_req, res) => {
  const subs = await query(
    `SELECT s.id, s.user_id AS userId, s.google_purchase_token AS googlePurchaseToken,
            s.product_id AS productId, s.status, s.started_at AS startedAt,
            s.expires_at AS expiresAt,
            u.email AS userEmail, u.name AS userName, u.plan AS userPlan
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     ORDER BY s.expires_at DESC LIMIT 200`
  );
  for (const s of subs) {
    s.user = { id: s.userId, email: s.userEmail, name: s.userName, plan: s.userPlan };
    delete s.userEmail; delete s.userName; delete s.userPlan;
  }
  res.json({ subscriptions: subs });
}));

router.post('/subscriptions/:id/refund', requireAdmin('super_admin'), asyncHandler(async (req, res) => {
  const sub = await prisma.subscription.update({
    where: { id: BigInt(req.params.id) },
    data: { status: 'cancelled' },
  });
  await prisma.user.update({ where: { id: sub.userId }, data: { plan: 'free' } });
  res.json({ ok: true });
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
