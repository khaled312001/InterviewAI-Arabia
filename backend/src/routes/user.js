import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';

import { prisma } from '../db/prisma.js';
import { requireUser } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';

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

router.get('/stats', requireUser, asyncHandler(async (req, res) => {
  const [sessionCount, answerAgg, recentSessions, categoryBreakdown] = await Promise.all([
    prisma.session.count({ where: { userId: req.userId } }),
    prisma.answer.aggregate({
      where: { session: { userId: req.userId }, aiScore: { not: null } },
      _avg: { aiScore: true },
      _count: { _all: true },
    }),
    prisma.session.findMany({
      where: { userId: req.userId },
      orderBy: { startedAt: 'desc' },
      take: 10,
      select: { id: true, totalScore: true, startedAt: true, endedAt: true, category: { select: { nameAr: true, nameEn: true } } },
    }),
    prisma.session.groupBy({
      by: ['categoryId'],
      where: { userId: req.userId },
      _count: { _all: true },
      _avg: { totalScore: true },
    }),
  ]);

  res.json({
    totalSessions: sessionCount,
    totalAnswers: answerAgg._count._all,
    averageScore: answerAgg._avg.aiScore ?? 0,
    recentSessions,
    categoryBreakdown,
  });
}));

export default router;
