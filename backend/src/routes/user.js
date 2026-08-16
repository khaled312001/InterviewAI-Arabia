import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
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
