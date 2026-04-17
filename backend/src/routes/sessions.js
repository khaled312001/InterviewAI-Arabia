import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../db/prisma.js';
import { query, queryOne } from '../db/mysql.js';
import { requireUser } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { aiLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { evaluateAnswer } from '../services/aiService.js';

const router = Router();

const startSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
});

const answerSchema = z.object({
  questionId: z.coerce.string().min(1),
  userAnswer: z.string().min(1).max(5000),
  language: z.enum(['ar', 'en']).optional(),
});

// Reset daily quota if last_reset_date is not today.
async function ensureDailyQuota(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(404, 'User not found');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const last = user.lastResetDate ? new Date(user.lastResetDate) : null;
  if (!last || last.getTime() < today.getTime()) {
    await prisma.user.update({
      where: { id: userId },
      data: { dailyQuestionsUsed: 0, lastResetDate: today },
    });
    user.dailyQuestionsUsed = 0;
  }
  return user;
}

router.post('/start', requireUser, asyncHandler(async (req, res) => {
  const { categoryId } = startSchema.parse(req.body);
  const user = await ensureDailyQuota(req.userId);

  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) throw new HttpError(404, 'Category not found');
  if (category.isPremium && user.plan !== 'premium') {
    throw new HttpError(402, 'هذا القسم للمشتركين فقط / Premium subscription required');
  }

  const firstQuestion = await prisma.question.findFirst({
    where: { categoryId, isActive: true },
    orderBy: [{ usageCount: 'asc' }, { id: 'asc' }],
  });
  if (!firstQuestion) throw new HttpError(404, 'No questions in this category yet');

  const session = await prisma.session.create({
    data: { userId: req.userId, categoryId },
  });

  res.status(201).json({
    sessionId: session.id.toString(),
    category,
    question: {
      id: firstQuestion.id.toString(),
      questionAr: firstQuestion.questionAr,
      questionEn: firstQuestion.questionEn,
      difficulty: firstQuestion.difficulty,
    },
    quota: {
      plan: user.plan,
      used: user.dailyQuestionsUsed,
      limit: user.plan === 'premium' ? null : env.FREE_DAILY_QUESTION_LIMIT,
    },
  });
}));

router.post('/:id/answer', requireUser, aiLimiter, asyncHandler(async (req, res) => {
  const sessionId = BigInt(req.params.id);
  const body = answerSchema.parse(req.body);

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { category: true },
  });
  if (!session || session.userId !== req.userId) throw new HttpError(404, 'Session not found');
  if (session.endedAt) throw new HttpError(400, 'Session already ended');

  const user = await ensureDailyQuota(req.userId);
  if (user.plan !== 'premium' && user.dailyQuestionsUsed >= env.FREE_DAILY_QUESTION_LIMIT) {
    throw new HttpError(402, 'تجاوزت الحد اليومي للأسئلة المجانية / Daily free limit reached');
  }

  const question = await prisma.question.findUnique({ where: { id: BigInt(body.questionId) } });
  if (!question) throw new HttpError(404, 'Question not found');

  const language = body.language || 'ar';
  const questionText = language === 'ar' ? question.questionAr : question.questionEn;

  const { result, tokensUsed } = await evaluateAnswer({
    question: questionText,
    userAnswer: body.userAnswer,
    language,
    userId: req.userId,
  });

  const answer = await prisma.answer.create({
    data: {
      sessionId,
      questionId: question.id,
      userAnswer: body.userAnswer,
      aiScore: result.score ?? null,
      aiFeedback: JSON.stringify(result),
      tokensUsed,
    },
  });

  await Promise.all([
    prisma.question.update({ where: { id: question.id }, data: { usageCount: { increment: 1 } } }),
    prisma.session.update({
      where: { id: sessionId },
      data: { totalScore: { increment: result.score ?? 0 } },
    }),
    prisma.user.update({
      where: { id: req.userId },
      data: { dailyQuestionsUsed: { increment: 1 } },
    }),
  ]);

  // Pick next unused question in this category.
  const nextQuestion = await prisma.question.findFirst({
    where: {
      categoryId: session.categoryId,
      isActive: true,
      id: { notIn: await prisma.answer.findMany({
        where: { sessionId },
        select: { questionId: true },
      }).then((rows) => rows.map((r) => r.questionId)) },
    },
    orderBy: [{ usageCount: 'asc' }, { id: 'asc' }],
  });

  res.json({
    answerId: answer.id.toString(),
    feedback: result,
    tokensUsed,
    nextQuestion: nextQuestion
      ? {
          id: nextQuestion.id.toString(),
          questionAr: nextQuestion.questionAr,
          questionEn: nextQuestion.questionEn,
          difficulty: nextQuestion.difficulty,
        }
      : null,
    quotaRemaining: user.plan === 'premium'
      ? null
      : Math.max(0, env.FREE_DAILY_QUESTION_LIMIT - (user.dailyQuestionsUsed + 1)),
  });
}));

router.post('/:id/end', requireUser, asyncHandler(async (req, res) => {
  const sessionId = BigInt(req.params.id);
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== req.userId) throw new HttpError(404, 'Session not found');
  const updated = await prisma.session.update({
    where: { id: sessionId },
    data: { endedAt: new Date() },
    include: { answers: { include: { question: true } }, category: true },
  });
  res.json({ session: updated });
}));

router.get('/:id', requireUser, asyncHandler(async (req, res) => {
  const sessionId = BigInt(req.params.id);
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      category: true,
      answers: { include: { question: true }, orderBy: { id: 'asc' } },
    },
  });
  if (!session || session.userId !== req.userId) throw new HttpError(404, 'Session not found');
  res.json({ session });
}));

router.get('/', requireUser, asyncHandler(async (req, res) => {
  // Raw mysql2 — findMany panics under Hostinger OpenSSL 1.1.x.
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const [items, totalRow] = await Promise.all([
    query(
      `SELECT s.id, s.user_id AS userId, s.category_id AS categoryId,
              s.total_score AS totalScore, s.started_at AS startedAt, s.ended_at AS endedAt,
              c.name_ar AS categoryNameAr, c.name_en AS categoryNameEn, c.icon AS categoryIcon,
              (SELECT COUNT(*) FROM answers a WHERE a.session_id = s.id) AS answersCount
       FROM sessions s
       JOIN categories c ON c.id = s.category_id
       WHERE s.user_id = ?
       ORDER BY s.started_at DESC
       LIMIT ? OFFSET ?`,
      [req.userId.toString(), limit, offset]
    ),
    queryOne('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', [req.userId.toString()]),
  ]);

  for (const s of items) {
    s.category = {
      id: s.categoryId,
      nameAr: s.categoryNameAr,
      nameEn: s.categoryNameEn,
      icon: s.categoryIcon,
    };
    s._count = { answers: Number(s.answersCount) };
    delete s.categoryNameAr; delete s.categoryNameEn; delete s.categoryIcon;
    delete s.answersCount;
  }
  res.json({ sessions: items, page, limit, total: Number(totalRow?.n || 0) });
}));

export default router;
