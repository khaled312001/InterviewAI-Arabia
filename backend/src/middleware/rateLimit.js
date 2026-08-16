import rateLimit from 'express-rate-limit';

/**
 * Rate limiters.
 *
 * Keying: expensive, authenticated endpoints are limited PER USER, not per IP.
 * IP keying alone is wrong in both directions here — an entire office or a
 * mobile carrier NAT shares one IP (so legitimate users block each other),
 * while one user on mobile data can rotate IPs freely (so an abuser is not
 * limited at all). Falling back to the IP only for anonymous callers gives
 * the right behaviour for both.
 *
 * Store: the default in-memory store is correct for this deployment — a
 * single long-lived Node process behind LiteSpeed. If the app is ever scaled
 * to multiple processes, swap in a Redis store, or each process will enforce
 * its own independent allowance.
 */

/**
 * Collapse an IPv6 address to its /64 prefix.
 *
 * A single IPv6 client is typically handed a whole /64, so keying on the full
 * address lets one host bypass any limit by varying the low hextets.
 * (express-rate-limit exports a helper for this, but only from v7.5 — doing it
 * here keeps the middleware working on the version already deployed.)
 */
function normaliseIp(ip) {
  if (!ip) return 'unknown';
  const addr = ip.startsWith('::ffff:') ? ip.slice(7) : ip; // IPv4-mapped
  if (!addr.includes(':')) return addr;                      // IPv4
  const parts = addr.split(':');
  return `${parts.slice(0, 4).join(':')}::/64`;
}

/** Per-user when authenticated; per-IP otherwise. */
function userOrIpKey(req) {
  if (req.userId) return `u:${req.userId}`;
  if (req.admin?.id) return `a:${req.admin.id}`;
  return normaliseIp(req.ip);
}

const base = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
};

/** Login / register / password reset — brute-force protection. */
export const authLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  max: 10,
  // Successful logins shouldn't count against the attempt budget; only
  // failures indicate guessing.
  skipSuccessfulRequests: true,
  message: { error: 'محاولات كثيرة جدًا. حاول بعد ١٥ دقيقة / Too many attempts, try again in 15 minutes' },
});

/**
 * Account CREATION, which is a different problem from account guessing.
 *
 * authLimiter sets `skipSuccessfulRequests`, deliberately and correctly: a
 * successful login is not evidence of brute force. Applied to /register the
 * same setting means a SUCCESSFUL registration is never counted, so registering
 * was free and unlimited — and every account is worth ten free minutes of model
 * time. A thousand accounts in a shell loop was a thousand trials, and the only
 * signal was the trial_grant sum in the ledger, after the spend.
 *
 * So this one counts every request, and is per-IP because there is no user yet.
 * Ten an hour is far above any honest household or office and far below a farm.
 * It is the volume control; services/billing/minutes.js:canonicalEmail() is the
 * uniqueness control. Neither is sufficient alone.
 */
export const registerLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => normaliseIp(req.ip),
  message: { error: 'محاولات تسجيل كثيرة. حاول بعد ساعة / Too many sign-ups from this network, try again in an hour' },
});

/** Blanket limit for the whole API. */
export const generalLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  max: 200,
  keyGenerator: userOrIpKey,
});

/** Anything that spends money at a model provider. */
export const aiLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: userOrIpKey,
  message: { error: 'طلبات كثيرة جدًا. انتظر قليلًا / Too many AI requests, please slow down' },
});

/**
 * The meeting heartbeat. Its own bucket, deliberately.
 *
 * /tick is called four times a minute and makes no AI call, so sharing
 * aiLimiter's 20/min budget with /turn would 429 an ordinary interview. That
 * failure mode is not merely noisy, it is a REFUND: a rejected tick's seconds
 * land on the next one as a >max-gap interval, which is billed at zero. Rate
 * limiting the meter hands out free minutes.
 */
export const tickLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: userOrIpKey,
  message: { error: 'طلبات كثيرة جدًا / Too many requests' },
});

/** CV parsing is the single most expensive call — a much tighter budget. */
export const heavyAiLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: userOrIpKey,
  message: { error: 'وصلت للحد الأقصى لتحليل السير الذاتية هذه الساعة / CV analysis limit reached for this hour' },
});

/**
 * Provider credential tests. Each one makes an outbound authenticated call to
 * a third party with an admin-supplied value, so without a cap the endpoint is
 * a credential-stuffing oracle against Anthropic/Google/Groq that happens to
 * be hosted on our infrastructure. Keyed per admin.
 */
export const integrationTestLimiter = rateLimit({
  ...base,
  windowMs: 5 * 60 * 1000,
  max: 20,
  keyGenerator: userOrIpKey,
  message: { error: 'محاولات اختبار كثيرة. حاول بعد قليل / Too many credential tests, slow down' },
});

/** Checkout creation — stops payment-record spam. */
export const paymentLimiter = rateLimit({
  ...base,
  windowMs: 10 * 60 * 1000,
  max: 8,
  keyGenerator: userOrIpKey,
  message: { error: 'محاولات دفع كثيرة. حاول بعد قليل / Too many payment attempts' },
});
