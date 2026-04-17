import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';

import { prisma } from '../db/prisma.js';
import { query, queryOne } from '../db/mysql.js';
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
