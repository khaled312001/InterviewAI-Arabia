/**
 * The customer dashboard's view of the desktop app.
 *
 * The desktop app keeps its own accounts on its own server. A customer links
 * theirs here once — by entering its email and password, which that server
 * checks — and the dashboard then shows the desktop plan beside everything
 * else. Nothing about the desktop account is shown before that proof: site
 * emails are not verified, so "same email" alone would let anyone read a
 * stranger's plan by registering with their address.
 *
 * The one exception is an account whose email Google verified: the person
 * already proved they own the address, so their desktop account (if any) is
 * shown without a password.
 */

import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { requireUser } from '../middleware/auth.js';
import { desktopLinkLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { query, queryOne } from '../db/mysql.js';

const router = Router();

const DOWNLOAD_PATH = '/download/';
const PRICING_PATH = '/download/pricing/';

function desktopConfigured() {
  return Boolean(env.MEETING_AI_API_URL && env.MEETING_AI_INTERNAL_SECRET.length >= 32);
}

/** One call to the desktop server's internal endpoint. Throws on transport errors. */
async function desktopAccount(email, password) {
  const res = await fetch(`${env.MEETING_AI_API_URL.replace(/\/+$/, '')}/api/internal/account`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.MEETING_AI_INTERNAL_SECRET}`,
      'content-type': 'application/json',
      // The desktop server's CSRF gate wants its client header on every POST.
      'x-requested-with': 'RIC-Desktop',
    },
    body: JSON.stringify(password == null ? { email } : { email, password }),
    signal: AbortSignal.timeout(6000),
  });
  if (res.status === 429) throw new HttpError(429, 'Too many attempts, try again later', undefined, 'DESKTOP_RATE_LIMITED');
  if (!res.ok) throw new Error(`desktop server ${res.status}`);
  return res.json();
}

/** A short cache so a dashboard refresh does not cost a round trip each time. */
const cache = new Map();
const CACHE_MS = 60_000;

async function desktopStatus(email) {
  const hit = cache.get(email);
  if (hit && hit.t > Date.now() - CACHE_MS) return hit.v;
  const v = await desktopAccount(email, null);
  cache.set(email, { t: Date.now(), v });
  if (cache.size > 2000) for (const [k, x] of cache) if (x.t < Date.now() - CACHE_MS) cache.delete(k);
  return v;
}

function out({ linked, via, email, account }) {
  return {
    available: true,
    linked,
    via,
    email,
    exists: Boolean(account?.exists),
    approved: Boolean(account?.approved),
    banned: Boolean(account?.banned),
    subscription: account?.subscription || null,
    downloadPath: DOWNLOAD_PATH,
    pricingPath: PRICING_PATH,
  };
}

/** GET /api/account/desktop — the linked desktop account and its plan. */
router.get('/desktop', requireUser, asyncHandler(async (req, res) => {
  if (!desktopConfigured()) return res.json({ available: false, downloadPath: DOWNLOAD_PATH, pricingPath: PRICING_PATH });

  const link = await queryOne('SELECT desktop_email FROM desktop_links WHERE user_id = ?', [String(req.userId)]);
  let email = link?.desktop_email || null;
  let via = email ? 'password' : null;
  if (!email) {
    const me = await queryOne('SELECT email, email_verified_at FROM users WHERE id = ?', [String(req.userId)]);
    if (me?.email_verified_at) { email = String(me.email).toLowerCase(); via = 'google'; }
  }
  if (!email) return res.json(out({ linked: false, via: null, email: null, account: null }));

  try {
    const account = await desktopStatus(email);
    // A Google-verified address with no desktop account is simply "not linked".
    if (via === 'google' && !account.exists) return res.json(out({ linked: false, via: null, email: null, account: null }));
    res.json(out({ linked: true, via, email, account }));
  } catch (err) {
    logger.warn('desktop status failed', { message: err.message });
    res.json({ ...out({ linked: true, via, email, account: null }), unreachable: true });
  }
}));

/** POST /api/account/desktop/link { email, password } */
router.post('/desktop/link', requireUser, desktopLinkLimiter, asyncHandler(async (req, res) => {
  if (!desktopConfigured()) throw new HttpError(503, 'Desktop linking is not available', undefined, 'DESKTOP_UNAVAILABLE');
  const body = z.object({
    email: z.string().trim().toLowerCase().email().max(191),
    password: z.string().min(1).max(200),
  }).parse(req.body);

  let account;
  try {
    account = await desktopAccount(body.email, body.password);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    logger.warn('desktop link check failed', { message: err.message });
    throw new HttpError(502, 'The desktop service did not answer. Try again in a minute.', undefined, 'DESKTOP_UNREACHABLE');
  }
  if (!account.passwordOk) throw new HttpError(401, 'Email or password is incorrect', undefined, 'DESKTOP_BAD_LOGIN');

  const taken = await queryOne('SELECT user_id FROM desktop_links WHERE desktop_email = ?', [body.email]);
  if (taken && String(taken.user_id) !== String(req.userId)) {
    throw new HttpError(409, 'This desktop account is already linked to another Interprova account', undefined, 'DESKTOP_LINKED_ELSEWHERE');
  }
  await query(
    `INSERT INTO desktop_links (user_id, desktop_email, linked_at) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE desktop_email = VALUES(desktop_email), linked_at = VALUES(linked_at)`,
    [String(req.userId), body.email, new Date()],
  );
  cache.set(body.email, { t: Date.now(), v: { ...account, passwordOk: undefined } });
  res.json(out({ linked: true, via: 'password', email: body.email, account }));
}));

/** DELETE /api/account/desktop/link — forget the link (the desktop account is untouched). */
router.delete('/desktop/link', requireUser, asyncHandler(async (req, res) => {
  await query('DELETE FROM desktop_links WHERE user_id = ?', [String(req.userId)]);
  res.json({ ok: true });
}));

export default router;
