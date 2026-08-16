import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../db/prisma.js';
import { query, queryOne } from '../db/mysql.js';
import { requireUser } from '../middleware/auth.js';
import { aiLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { evaluateAnswer, AiUnavailableError } from '../services/ai/index.js';
import { requireQuota, refundQuota, hasPremium, quotaSnapshot, QUOTA_COST } from '../services/quota.js';
import { logger } from '../utils/logger.js';

const router = Router();

const startSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
});

const answerSchema = z.object({
  questionId: z.coerce.string().min(1),
  userAnswer: z.string().trim().min(1).max(5000),
  language: z.enum(['ar', 'en']).optional(),
});

/* -------------------------------------------------------------------------
 * POST /api/sessions/start
 * ---------------------------------------------------------------------- */

router.post('/start', requireUser, asyncHandler(async (req, res) => {
  const { categoryId } = startSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new HttpError(404, 'User not found');
  if (user.isDisabled) throw new HttpError(403, 'هذا الحساب موقوف / This account is suspended');

  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category || !category.isActive) throw new HttpError(404, 'Category not found');

  if (category.isPremium && !hasPremium(user)) {
    throw new HttpError(402, 'Premium subscription required', undefined, 'PREMIUM_REQUIRED');
  }

  const firstQuestion = await prisma.question.findFirst({
    where: { categoryId, isActive: true },
    orderBy: [{ usageCount: 'asc' }, { id: 'asc' }],
  });
  if (!firstQuestion) throw new HttpError(404, 'لا توجد أسئلة في هذا القسم بعد / No questions in this category yet');

  const session = await prisma.session.create({
    data: { userId: req.userId, categoryId, kind: 'practice' },
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
    quota: await quotaSnapshot(user),
  });
}));

/* -------------------------------------------------------------------------
 * POST /api/sessions/:id/answer
 *
 * Order of operations matters and is deliberate:
 *   1. authorise the session
 *   2. consume quota ATOMICALLY (before spending money at the AI provider)
 *   3. call the model
 *   4. on failure → refund the quota and return 503; persist nothing
 *
 * The old code called the model first, swallowed any error into a stub scored
 * 6/10, persisted that as a real grade, and still charged the user's quota.
 * ---------------------------------------------------------------------- */

router.post('/:id/answer', requireUser, aiLimiter, asyncHandler(async (req, res) => {
  let sessionId;
  try { sessionId = BigInt(req.params.id); } catch { throw new HttpError(400, 'Invalid session id'); }

  const body = answerSchema.parse(req.body);

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { category: true },
  });
  if (!session || session.userId !== req.userId) throw new HttpError(404, 'Session not found');
  if (session.endedAt) throw new HttpError(400, 'انتهت هذه الجلسة بالفعل / Session already ended');

  let questionId;
  try { questionId = BigInt(body.questionId); } catch { throw new HttpError(400, 'Invalid question id'); }

  const question = await prisma.question.findUnique({ where: { id: questionId } });
  if (!question) throw new HttpError(404, 'Question not found');

  // Reject a replayed answer for a question already answered in this session,
  // which would otherwise let a user farm the same question repeatedly.
  const existing = await prisma.answer.findFirst({
    where: { sessionId, questionId },
    select: { id: true },
  });
  if (existing) throw new HttpError(409, 'تمت الإجابة على هذا السؤال بالفعل / This question was already answered');

  const language = body.language || 'ar';
  const questionText = language === 'ar' ? question.questionAr : question.questionEn;

  // 2. Atomic consume — no window between checking and spending.
  const quota = await requireQuota(req.userId, QUOTA_COST.answer);

  // 3. Model call.
  let evaluation;
  try {
    evaluation = await evaluateAnswer({
      question: questionText,
      userAnswer: body.userAnswer,
      language,
      userId: req.userId,
    });
  } catch (err) {
    // 4. Refund and fail loudly. Never invent a score.
    await refundQuota(req.userId, QUOTA_COST.answer);
    if (err instanceof AiUnavailableError) {
      logger.error('Answer evaluation failed', { sessionId: req.params.id, message: err.message });
      throw new HttpError(503, 'Evaluation is temporarily unavailable; this question was not counted', undefined, 'AI_UNAVAILABLE');
    }
    throw err;
  }

  const { result, tokensUsed } = evaluation;
  // Structured outputs constrain score to 0–10, but clamp anyway: a provider
  // fallback (Groq) has no decode-time schema guarantee.
  const score = Math.max(0, Math.min(10, Math.round(Number(result.score) || 0)));

  const [answer] = await prisma.$transaction([
    prisma.answer.create({
      data: {
        sessionId,
        questionId: question.id,
        questionText,
        userAnswer: body.userAnswer,
        aiScore: score,
        aiFeedback: JSON.stringify(result),
        tokensUsed,
      },
    }),
    prisma.question.update({
      where: { id: question.id },
      data: { usageCount: { increment: 1 } },
    }),
    prisma.session.update({
      where: { id: sessionId },
      data: { totalScore: { increment: score }, answerCount: { increment: 1 } },
    }),
  ]);

  // Next unused question. Done as one query instead of the previous nested
  // `notIn: await prisma.answer.findMany(...)`, which issued a second round
  // trip inside the filter object on every answer.
  const nextQuestion = await prisma.$queryRaw`
    SELECT id, question_ar AS questionAr, question_en AS questionEn, difficulty
      FROM questions
     WHERE category_id = ${session.categoryId}
       AND is_active = 1
       AND id NOT IN (SELECT question_id FROM answers WHERE session_id = ${sessionId} AND question_id IS NOT NULL)
     ORDER BY usage_count ASC, id ASC
     LIMIT 1
  `.then((rows) => rows[0] ?? null);

  res.json({
    answerId: answer.id.toString(),
    feedback: result,
    tokensUsed,
    nextQuestion: nextQuestion
      ? {
          id: String(nextQuestion.id),
          questionAr: nextQuestion.questionAr,
          questionEn: nextQuestion.questionEn,
          difficulty: nextQuestion.difficulty,
        }
      : null,
    quotaRemaining: quota.remaining,
  });
}));

/* -------------------------------------------------------------------------
 * POST /api/sessions/:id/end
 * ---------------------------------------------------------------------- */

router.post('/:id/end', requireUser, asyncHandler(async (req, res) => {
  let sessionId;
  try { sessionId = BigInt(req.params.id); } catch { throw new HttpError(400, 'Invalid session id'); }

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== req.userId) throw new HttpError(404, 'Session not found');

  const updated = session.endedAt
    ? session
    : await prisma.session.update({ where: { id: sessionId }, data: { endedAt: new Date() } });

  const full = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { category: true, answers: { orderBy: { id: 'asc' } } },
  });

  res.json({ session: { ...full, endedAt: updated.endedAt } });
}));

/* -------------------------------------------------------------------------
 * GET /api/sessions/:id
 * ---------------------------------------------------------------------- */

router.get('/:id', requireUser, asyncHandler(async (req, res) => {
  let sessionId;
  try { sessionId = BigInt(req.params.id); } catch { throw new HttpError(400, 'Invalid session id'); }

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

/* -------------------------------------------------------------------------
 * GET /api/sessions — paginated history
 * ---------------------------------------------------------------------- */

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  kind: z.enum(['practice', 'meeting']).optional(),
});

router.get('/', requireUser, asyncHandler(async (req, res) => {
  const { page, limit, kind } = listQuery.parse(req.query);
  const offset = (page - 1) * limit;
  const uid = req.userId.toString();

  // `answer_count` is now denormalised on the session row, so this no longer
  // runs a correlated COUNT subquery per returned row.
  const kindClause = kind ? 'AND s.kind = ?' : '';
  const params = kind ? [uid, kind] : [uid];

  const [items, totalRow] = await Promise.all([
    query(
      `SELECT s.id, s.category_id AS categoryId, s.kind,
              s.total_score AS totalScore, s.answer_count AS answersCount,
              s.started_at AS startedAt, s.ended_at AS endedAt,
              c.name_ar AS categoryNameAr, c.name_en AS categoryNameEn, c.icon AS categoryIcon
         FROM sessions s
         JOIN categories c ON c.id = s.category_id
        WHERE s.user_id = ? ${kindClause}
        ORDER BY s.started_at DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
    queryOne(
      `SELECT COUNT(*) AS n FROM sessions s WHERE s.user_id = ? ${kindClause}`,
      params,
    ),
  ]);

  const sessions = items.map((s) => ({
    id: s.id,
    kind: s.kind,
    totalScore: Number(s.totalScore),
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    averageScore: s.answersCount > 0
      ? Number((Number(s.totalScore) / Number(s.answersCount)).toFixed(1))
      : 0,
    category: {
      id: s.categoryId,
      nameAr: s.categoryNameAr,
      nameEn: s.categoryNameEn,
      icon: s.categoryIcon,
    },
    _count: { answers: Number(s.answersCount) },
  }));

  res.json({ sessions, page, limit, total: Number(totalRow?.n || 0) });
}));

export default router;
