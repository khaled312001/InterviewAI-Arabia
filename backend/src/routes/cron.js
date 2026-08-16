/**
 * Scheduled maintenance, exposed over HTTP for external schedulers.
 *
 * SECURITY NOTE — the previous version began with:
 *
 *     if (req.ip === '127.0.0.1' || req.ip === '::1') return next();
 *
 * With `trust proxy` enabled, `req.ip` is derived from the X-Forwarded-For
 * header, so any anonymous request could present itself as loopback and run
 * these jobs. That let anyone on the internet reset every user's daily AI
 * quota — unlimited free AI spend, billed to us. The bypass is gone: the
 * secret is now mandatory and compared in constant time.
 */

import { Router } from 'express';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { expireSubscriptions, purgeExpiredTokens } from '../services/maintenance.js';

const router = Router();

function requireCronAuth(req, _res, next) {
  if (!env.CRON_SECRET) {
    logger.error('Cron endpoint hit but CRON_SECRET is not configured');
    return next(new HttpError(503, 'Cron is not configured'));
  }
  const provided = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(env.CRON_SECRET);
  // timingSafeEqual throws on length mismatch, so check length first — and
  // never short-circuit on it in a way that leaks the secret's length beyond
  // what an attacker already learns from a failed request.
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return next(new HttpError(401, 'Cron auth required'));
  next();
}

router.use(requireCronAuth);

/**
 * Subscription expiry sweep.
 *
 * NOTE: there is deliberately no "daily quota reset" job any more.
 * The old one ran `UPDATE users SET daily_questions_used = 0` at 22:00 UTC —
 * i.e. midnight Cairo — while the per-request check computed its own
 * boundary from server-local midnight. Free users therefore received a
 * second full allowance every evening. The quota now rolls over lazily
 * inside the atomic consume in services/quota.js, which is the only clock
 * the check consults.
 */
router.all('/daily', asyncHandler(async (_req, res) => {
  const started = Date.now();
  const expired = await expireSubscriptions();
  const tokens = await purgeExpiredTokens();
  logger.info('Cron: daily', { ...expired, ...tokens, ms: Date.now() - started });
  res.json({ ok: true, ...expired, ...tokens });
}));

router.all('/expire-subscriptions', asyncHandler(async (_req, res) => {
  const result = await expireSubscriptions();
  res.json({ ok: true, ...result });
}));

export default router;
