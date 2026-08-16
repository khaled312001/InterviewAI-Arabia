/**
 * Live mock interview ("meeting") — the flagship feature.
 *
 * Rewritten for three reasons:
 *
 * 1. It called Groq directly with its own hardcoded fetch, its own prompt
 *    builder, and its own copy of the JSON-scraping logic. Switching the
 *    product to Claude therefore left this feature — the most expensive and
 *    most marketed one — still on the old provider.
 * 2. None of the three endpoints consumed any quota, and /prepare had no AI
 *    rate limiter at all. A free user could run unlimited interviews and CV
 *    analyses, each far more expensive than the metered practice answers.
 * 3. /finish wrote answers with a hardcoded `questionId: 1`, corrupting that
 *    question's usage statistics and lying about the foreign key.
 */

import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';

import { logger } from '../utils/logger.js';
import { requireUser } from '../middleware/auth.js';
import { aiLimiter, heavyAiLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { prisma } from '../db/prisma.js';
import { meetingTurn, evaluateInterview, summarizeCv, AiUnavailableError } from '../services/ai/index.js';
import { requireQuota, refundQuota, hasPremium, QUOTA_COST } from '../services/quota.js';

const router = Router();

const MAX_TURNS = 40;
const TARGET_ASSISTANT_TURNS = 7;

// pdf-parse is loaded lazily: its module-level debug branch probes for a test
// fixture that does not exist in a production install and throws at import.
async function parsePdf(buffer) {
  const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
  return pdfParse(buffer);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  // The old config accepted ANY file type and fed the bytes straight to an
  // unmaintained PDF parser.
  fileFilter(_req, file, cb) {
    const ok = file.mimetype === 'application/pdf'
      || file.mimetype === 'text/plain'
      || /\.(pdf|txt|md)$/i.test(file.originalname);
    cb(null, ok);
  },
});

/* ------------------------------------------------------------------ *
 * Shared guards
 * ------------------------------------------------------------------ */

async function loadCategoryFor(req, categoryId) {
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category || !category.isActive) throw new HttpError(404, 'Category not found');

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new HttpError(404, 'User not found');
  if (user.isDisabled) throw new HttpError(403, 'هذا الحساب موقوف / This account is suspended');

  if (category.isPremium && !hasPremium(user)) {
    throw new HttpError(402, 'Premium subscription required', undefined, 'PREMIUM_REQUIRED');
  }
  return { category, user };
}

const contextSchema = z.object({
  categoryId: z.coerce.number().int().positive().optional(),
  company: z.string().max(200).nullable().optional(),
  jobTitle: z.string().max(200).nullable().optional(),
  jobDescription: z.string().max(6000).nullable().optional(),
  cvSummary: z.string().max(4000).nullable().optional(),
  cvKey: z.any().optional(),
  gender: z.enum(['male', 'female']).optional(),
}).nullable().optional();

/* ------------------------------------------------------------------ *
 * POST /api/meeting/prepare — CV + job context
 * ------------------------------------------------------------------ */

router.post('/prepare', requireUser, heavyAiLimiter, upload.single('cv'), asyncHandler(async (req, res) => {
  const schema = z.object({
    categoryId: z.coerce.number().int().positive(),
    company: z.string().max(200).optional().default(''),
    jobTitle: z.string().max(200).optional().default(''),
    jobDescription: z.string().max(6000).optional().default(''),
    language: z.enum(['ar', 'en']).optional().default('ar'),
    gender: z.enum(['male', 'female']).optional().default('female'),
  });
  const body = schema.parse(req.body);
  await loadCategoryFor(req, body.categoryId);

  let cvText = '';
  let cvError = null;

  if (req.file) {
    try {
      if (req.file.mimetype === 'application/pdf' || /\.pdf$/i.test(req.file.originalname)) {
        const parsed = await parsePdf(req.file.buffer);
        cvText = (parsed?.text || '').trim();
      } else {
        cvText = req.file.buffer.toString('utf-8').trim();
      }
    } catch (err) {
      logger.warn('CV parse failed', { message: err.message });
      cvError = 'تعذّر قراءة السيرة الذاتية. جرّب رفع نسخة PDF نصية (وليست صورة ممسوحة ضوئيًا).';
    }
    if (!cvText && !cvError) {
      cvError = 'الملف لا يحتوي على نص قابل للقراءة. إذا كانت سيرتك صورة ممسوحة، صدّرها كـ PDF نصي.';
    }
  }

  let cvSummary = null;
  let cvKey = null;

  if (cvText) {
    // CV analysis is the most expensive single call in the product.
    await requireQuota(req.userId, QUOTA_COST.meetingPrepare);
    try {
      const out = await summarizeCv({ cvText, language: body.language, userId: req.userId });
      cvSummary = out.cvSummary;
      cvKey = out.cvKey;
    } catch (err) {
      await refundQuota(req.userId, QUOTA_COST.meetingPrepare);
      if (err instanceof AiUnavailableError) {
        logger.error('CV summarise failed', { message: err.message });
        cvError = 'تعذّر تحليل السيرة الذاتية حاليًا. يمكنك متابعة المقابلة بدونها.';
      } else throw err;
    }
  }

  res.json({
    context: {
      categoryId: body.categoryId,
      company: body.company.trim() || null,
      jobTitle: body.jobTitle.trim() || null,
      jobDescription: body.jobDescription.trim() || null,
      gender: body.gender,
      cvSummary,
      cvKey,
    },
    cvError,
    cvHasText: Boolean(cvText),
  });
}));

/* ------------------------------------------------------------------ *
 * POST /api/meeting/turn
 * ------------------------------------------------------------------ */

const turnSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(3000),
  })).default([]),
  userMessage: z.string().max(3000).optional().default(''),
  language: z.enum(['ar', 'en']).optional().default('ar'),
  context: contextSchema,
});

router.post('/turn', requireUser, aiLimiter, asyncHandler(async (req, res) => {
  const body = turnSchema.parse(req.body);
  const { category, user } = await loadCategoryFor(req, body.categoryId);

  // The old schema hard-rejected a history longer than 20 with a 400, which
  // killed the interview mid-conversation. Keep the opening turn (it anchors
  // the persona and company) plus the most recent exchanges, and drop the
  // middle — the model keeps its bearings and the request stays bounded.
  let history = body.history;
  if (history.length > MAX_TURNS) {
    history = [history[0], ...history.slice(-(MAX_TURNS - 1))];
  }

  // The opening turn is free — nobody should spend quota on "hello".
  const isOpening = history.length === 0 && !body.userMessage;
  if (!isOpening) await requireQuota(req.userId, QUOTA_COST.meetingTurn);

  const assistantTurns = history.filter((h) => h.role === 'assistant').length;

  try {
    const out = await meetingTurn({
      history,
      userMessage: body.userMessage,
      language: body.language,
      gender: body.context?.gender || 'female',
      context: body.context
        ? { ...body.context, jobTitle: body.context.jobTitle || (body.language === 'ar' ? category.nameAr : category.nameEn) }
        : null,
      userId: req.userId,
      shouldClose: assistantTurns >= TARGET_ASSISTANT_TURNS,
    });

    res.json({
      reply: out.reply,
      status: out.status,
      note: out.note,
      tips: out.tips,
      tokensUsed: out.tokensUsed,
      turnIndex: history.length + (body.userMessage ? 1 : 0),
    });
  } catch (err) {
    if (!isOpening) await refundQuota(req.userId, QUOTA_COST.meetingTurn);
    if (err instanceof AiUnavailableError) {
      logger.error('Meeting turn failed', { message: err.message });
      throw new HttpError(503, 'The interviewer is temporarily unavailable', undefined, 'AI_UNAVAILABLE');
    }
    throw err;
  }
}));

/* ------------------------------------------------------------------ *
 * POST /api/meeting/finish
 * ------------------------------------------------------------------ */

const finishSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(3000),
  })).min(2),
  language: z.enum(['ar', 'en']).optional().default('ar'),
  context: contextSchema,
});

router.post('/finish', requireUser, aiLimiter, asyncHandler(async (req, res) => {
  const body = finishSchema.parse(req.body);
  await loadCategoryFor(req, body.categoryId);

  await requireQuota(req.userId, QUOTA_COST.meetingFinish);

  let evaluation;
  try {
    const out = await evaluateInterview({
      history: body.history,
      language: body.language,
      context: body.context || null,
      userId: req.userId,
    });
    evaluation = out.evaluation;

    // Persist as a session so it appears in History and Stats.
    const answered = body.history.filter((h) => h.role === 'user');
    const overall = Math.max(0, Math.min(10, Math.round(Number(evaluation.overall_score) || 0)));

    await prisma.$transaction(async (tx) => {
      const session = await tx.session.create({
        data: {
          userId: req.userId,
          categoryId: body.categoryId,
          kind: 'meeting',
          totalScore: overall * answered.length,
          answerCount: answered.length,
          startedAt: new Date(Date.now() - body.history.length * 60_000),
          endedAt: new Date(),
        },
      });

      // Pair each candidate reply with the question that preceded it.
      const rows = [];
      let lastQuestion = null;
      let i = 0;
      for (const turn of body.history) {
        if (turn.role === 'assistant') { lastQuestion = turn.content; continue; }
        const perQ = evaluation.per_question?.[i];
        rows.push({
          sessionId: session.id,
          // NULL rather than a fabricated FK to question #1.
          questionId: null,
          questionText: lastQuestion,
          userAnswer: turn.content,
          aiScore: Math.max(0, Math.min(10, Math.round(Number(perQ?.score ?? overall) || 0))),
          aiFeedback: JSON.stringify({
            meeting: true,
            comment: perQ?.comment ?? evaluation.summary,
          }),
          tokensUsed: 0,
        });
        i += 1;
      }
      if (rows.length) await tx.answer.createMany({ data: rows });
    });

    res.json({ evaluation, tokensUsed: out.tokensUsed });
  } catch (err) {
    await refundQuota(req.userId, QUOTA_COST.meetingFinish);
    if (err instanceof AiUnavailableError) {
      logger.error('Interview evaluation failed', { message: err.message });
      throw new HttpError(503, 'Could not generate the final evaluation', undefined, 'AI_UNAVAILABLE');
    }
    throw err;
  }
}));

export default router;
