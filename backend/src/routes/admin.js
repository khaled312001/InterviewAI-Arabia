import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';

import { prisma } from '../db/prisma.js';
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
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const q = (req.query.q || '').toString().trim();
  const where = q ? { OR: [{ email: { contains: q } }, { name: { contains: q } }] } : {};
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
    }),
    prisma.user.count({ where }),
  ]);
  res.json({ users, page, limit, total });
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
  const sessions = await prisma.session.findMany({
    where: { userId: BigInt(req.params.id) },
    orderBy: { startedAt: 'desc' },
    take: 100,
    include: { category: true, _count: { select: { answers: true } } },
  });
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
  const where = req.query.categoryId ? { categoryId: Number(req.query.categoryId) } : {};
  const [questions, total] = await Promise.all([
    prisma.question.findMany({
      where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit, include: { category: true },
    }),
    prisma.question.count({ where }),
  ]);
  res.json({ questions, page, limit, total });
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
  const subs = await prisma.subscription.findMany({
    orderBy: { expiresAt: 'desc' },
    take: 200,
    include: { user: { select: { id: true, email: true, name: true, plan: true } } },
  });
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

  const [totalUsers, activeToday, premiumUsers, newUsers30d, sessionsToday, answers30d] = await Promise.all([
    prisma.user.count(),
    prisma.session.groupBy({ by: ['userId'], where: { startedAt: { gte: today } } }).then((r) => r.length),
    prisma.user.count({ where: { plan: 'premium' } }),
    prisma.user.count({ where: { createdAt: { gte: since } } }),
    prisma.session.count({ where: { startedAt: { gte: today } } }),
    prisma.answer.count({ where: { createdAt: { gte: since } } }),
  ]);

  res.json({
    totalUsers, activeToday, premiumUsers, newUsers30d, sessionsToday, answers30d,
    conversionRate: totalUsers ? (premiumUsers / totalUsers) : 0,
  });
}));

router.get('/analytics/popular-categories', requireAdmin(), asyncHandler(async (_req, res) => {
  const rows = await prisma.session.groupBy({
    by: ['categoryId'],
    _count: { _all: true },
    orderBy: { _count: { categoryId: 'desc' } },
    take: 20,
  });
  const categories = await prisma.category.findMany({
    where: { id: { in: rows.map((r) => r.categoryId) } },
  });
  const map = Object.fromEntries(categories.map((c) => [c.id, c]));
  res.json({
    rows: rows.map((r) => ({ category: map[r.categoryId], sessions: r._count._all })),
  });
}));

router.get('/ai-usage', requireAdmin(), asyncHandler(async (_req, res) => {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const logs = await prisma.claudeApiLog.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const summary = await prisma.claudeApiLog.aggregate({
    where: { createdAt: { gte: since } },
    _sum: { inputTokens: true, outputTokens: true },
    _count: { _all: true },
  });
  res.json({ logs, summary });
}));

/* -----------------------  content moderation  ---------------------- */

router.get('/reports', requireAdmin(), asyncHandler(async (_req, res) => {
  const reports = await prisma.answerReport.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { answer: { include: { question: true } }, reporter: { select: { id: true, email: true } } },
  });
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
  const rows = await prisma.appSetting.findMany();
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
  const admins = await prisma.adminUser.findMany({ orderBy: { createdAt: 'desc' } });
  res.json({ admins: admins.map(({ passwordHash: _ph, ...rest }) => rest) });
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
