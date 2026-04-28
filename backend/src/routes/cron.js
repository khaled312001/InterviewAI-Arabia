// Cron HTTP endpoints — invoked by Vercel Cron (vercel.json schedules them).
// On Hostinger we use in-process node-cron (services/cron.js); on Vercel we
// hit these endpoints from the cron scheduler instead.
//
// Auth: Vercel sends an Authorization header with `Bearer ${CRON_SECRET}`.
// In addition we accept Hostinger's own scheduled POSTs by bypassing the
// secret if the request is loopback (127.0.0.1). For safety in production,
// always set CRON_SECRET in env.

import { Router } from 'express';
import { env } from '../config/env.js';
import { query } from '../db/mysql.js';
import { logger } from '../utils/logger.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';

const router = Router();

function requireCronAuth(req, _res, next) {
  if (req.ip === '127.0.0.1' || req.ip === '::1') return next();
  const header = req.headers.authorization || '';
  const provided = header.replace(/^Bearer\s+/i, '');
  if (!env.CRON_SECRET || provided !== env.CRON_SECRET) {
    return next(new HttpError(401, 'Cron auth required'));
  }
  next();
}

// Daily quota reset — runs once a day at 00:00 Africa/Cairo (configured in vercel.json).
router.all('/daily-reset', requireCronAuth, asyncHandler(async (_req, res) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const result = await query(
    'UPDATE users SET daily_questions_used = 0, last_reset_date = ?',
    [today]
  );
  logger.info('Cron: daily-reset', { affected: result.affectedRows });
  res.json({ ok: true, affected: result.affectedRows, at: today.toISOString() });
}));

// Subscription expiry sweep — kept callable directly for ops/manual runs.
router.all('/expire-subscriptions', requireCronAuth, asyncHandler(async (_req, res) => {
  const now = new Date();
  const expired = await query(
    'SELECT id, user_id FROM subscriptions WHERE status = "active" AND expires_at < ?',
    [now]
  );
  if (!expired.length) return res.json({ ok: true, expired: 0 });

  const ids = expired.map((s) => s.id);
  const userIds = [...new Set(expired.map((s) => s.user_id.toString()))];
  await query(`UPDATE subscriptions SET status = 'expired' WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  await query(`UPDATE users SET plan = 'free' WHERE id IN (${userIds.map(() => '?').join(',')})`, userIds);
  logger.info('Cron: expire-subscriptions', { count: expired.length });
  res.json({ ok: true, expired: expired.length });
}));

// Combined daily cron — Vercel Hobby allows only one schedule per cron, and
// each must run at most once per day. We fold both jobs (quota reset +
// subscription expiry) into one endpoint with one schedule. Runs at 22:00
// UTC = ~00:00 Africa/Cairo. On Hostinger this endpoint is unused (in-
// process node-cron handles each job on its own cadence).
router.all('/daily', requireCronAuth, asyncHandler(async (_req, res) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const now = new Date();

  // 1. Daily quota reset
  const reset = await query(
    'UPDATE users SET daily_questions_used = 0, last_reset_date = ?',
    [today]
  );

  // 2. Expire subscriptions whose expires_at has passed
  const expired = await query(
    'SELECT id, user_id FROM subscriptions WHERE status = "active" AND expires_at < ?',
    [now]
  );
  let expiredCount = 0;
  if (expired.length) {
    const ids = expired.map((s) => s.id);
    const userIds = [...new Set(expired.map((s) => s.user_id.toString()))];
    await query(`UPDATE subscriptions SET status = 'expired' WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    await query(`UPDATE users SET plan = 'free' WHERE id IN (${userIds.map(() => '?').join(',')})`, userIds);
    expiredCount = expired.length;
  }

  logger.info('Cron: daily', { quotaReset: reset.affectedRows, expired: expiredCount });
  res.json({
    ok: true,
    quotaReset: reset.affectedRows,
    subscriptionsExpired: expiredCount,
    at: now.toISOString(),
  });
}));

export default router;
