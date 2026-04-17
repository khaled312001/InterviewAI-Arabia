import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../db/prisma.js';
import { requireUser } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(async (_req, res) => {
  const categories = await prisma.category.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  res.json({ categories });
}));

const questionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
});

router.get('/:id/questions', requireUser, asyncHandler(async (req, res) => {
  const categoryId = Number(req.params.id);
  if (!Number.isInteger(categoryId)) throw new HttpError(400, 'Invalid category id');
  const { limit, difficulty } = questionsQuery.parse(req.query);

  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) throw new HttpError(404, 'Category not found');

  if (category.isPremium) {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { plan: true } });
    if (user?.plan !== 'premium') throw new HttpError(402, 'هذا القسم للمشتركين فقط / Premium subscription required');
  }

  // MySQL lacks Prisma's random orderBy, so pull a pool and shuffle in JS.
  const pool = await prisma.question.findMany({
    where: { categoryId, isActive: true, ...(difficulty ? { difficulty } : {}) },
    take: Math.max(limit * 5, 30),
    orderBy: { usageCount: 'asc' },
  });
  const shuffled = pool.sort(() => Math.random() - 0.5).slice(0, limit);

  res.json({
    category,
    questions: shuffled.map((q) => ({
      id: q.id.toString(),
      questionAr: q.questionAr,
      questionEn: q.questionEn,
      difficulty: q.difficulty,
    })),
  });
}));

export default router;
