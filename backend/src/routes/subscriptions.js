import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { requireUser } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { logger } from '../utils/logger.js';
import { verifyGooglePlayPurchase } from '../services/googlePlay.js';

const router = Router();

const verifySchema = z.object({
  productId: z.string().min(1),
  purchaseToken: z.string().min(10),
});

router.post('/verify', requireUser, asyncHandler(async (req, res) => {
  const { productId, purchaseToken } = verifySchema.parse(req.body);

  let verification;
  if (env.GOOGLE_PLAY_ENABLED) {
    verification = await verifyGooglePlayPurchase({ productId, purchaseToken });
  } else {
    logger.warn('GOOGLE_PLAY_ENABLED=false — accepting purchase without server-side verification (dev only)');
    verification = {
      valid: true,
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      raw: { devStub: true },
    };
  }

  if (!verification.valid) throw new HttpError(400, 'فشل التحقق من الاشتراك / Purchase verification failed');

  const existing = await prisma.subscription.findUnique({ where: { googlePurchaseToken: purchaseToken } });
  if (existing && existing.userId !== req.userId) {
    throw new HttpError(409, 'Purchase already linked to another account');
  }

  const sub = existing
    ? await prisma.subscription.update({
        where: { id: existing.id },
        data: {
          status: 'active',
          expiresAt: verification.expiresAt,
          rawPayload: JSON.stringify(verification.raw),
        },
      })
    : await prisma.subscription.create({
        data: {
          userId: req.userId,
          googlePurchaseToken: purchaseToken,
          productId,
          status: 'active',
          expiresAt: verification.expiresAt,
          rawPayload: JSON.stringify(verification.raw),
        },
      });

  await prisma.user.update({ where: { id: req.userId }, data: { plan: 'premium' } });

  res.json({ subscription: { ...sub, id: sub.id.toString(), userId: sub.userId.toString() } });
}));

router.get('/status', requireUser, asyncHandler(async (req, res) => {
  const sub = await prisma.subscription.findFirst({
    where: { userId: req.userId },
    orderBy: { expiresAt: 'desc' },
  });
  const active = sub && sub.status === 'active' && sub.expiresAt > new Date();
  if (sub && !active && sub.status === 'active') {
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'expired' } });
    await prisma.user.update({ where: { id: req.userId }, data: { plan: 'free' } });
  }
  res.json({
    active: Boolean(active),
    plan: active ? 'premium' : 'free',
    subscription: sub
      ? { ...sub, id: sub.id.toString(), userId: sub.userId.toString() }
      : null,
  });
}));

export default router;
