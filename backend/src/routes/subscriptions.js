/**
 * Subscription status.
 *
 * ── REMOVED: POST /verify ────────────────────────────────────────────────
 * The previous build exposed `POST /api/subscriptions/verify`, which took an
 * arbitrary `purchaseToken` string and — because `GOOGLE_PLAY_ENABLED`
 * defaults to false — took the branch that hardcoded:
 *
 *     verification = { valid: true, expiresAt: +30 days, raw: { devStub: true } }
 *
 * …and then wrote `plan: 'premium'` for the caller. Any logged-in user could
 * grant themselves a month of premium with one request, so subscription
 * revenue would have been effectively zero on launch day. Turning the flag on
 * did not fix it either: the verifier stub it selected returns `{valid:false}`
 * unconditionally, so the endpoint had no configuration in which it actually
 * verified anything.
 *
 * Premium is now granted in exactly one place: the payment webhook in
 * routes/payments.js, after the gateway signature, the amount, and the
 * currency have all been checked against a Payment row we created ourselves.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { Router } from 'express';

import { prisma } from '../db/prisma.js';
import { requireUser } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { hasPremium } from '../services/quota.js';

const router = Router();

/** GET /api/subscriptions/status */
router.get('/status', requireUser, asyncHandler(async (req, res) => {
  const now = new Date();

  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { plan: true, premiumUntil: true },
  });
  if (!user) throw new HttpError(404, 'User not found');

  // Only `active` rows resolve status. The old query ordered every row by
  // `expiresAt` and took the first, so a *pending* checkout — which was
  // written with a future expiry before any money moved — could outrank the
  // real subscription and report a paying customer as free.
  const subscription = await prisma.subscription.findFirst({
    where: { userId: req.userId, status: 'active', expiresAt: { gt: now } },
    orderBy: { expiresAt: 'desc' },
  });

  const active = Boolean(subscription) || hasPremium(user, now);

  res.json({
    active,
    plan: active ? 'premium' : 'free',
    premiumUntil: subscription?.expiresAt ?? user.premiumUntil ?? null,
    subscription: subscription
      ? {
          id: subscription.id.toString(),
          planCode: subscription.planCode,
          status: subscription.status,
          startedAt: subscription.startedAt,
          expiresAt: subscription.expiresAt,
          autoRenew: subscription.autoRenew,
        }
      : null,
  });
}));

/** GET /api/subscriptions/history — the user's own payment record. */
router.get('/history', requireUser, asyncHandler(async (req, res) => {
  const payments = await prisma.payment.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      reference: true, planCode: true, amountCents: true, currency: true,
      status: true, method: true, paidAt: true, createdAt: true,
    },
  });

  res.json({
    payments: payments.map((p) => ({
      ...p,
      amountEgp: p.amountCents / 100,
    })),
  });
}));

export default router;
