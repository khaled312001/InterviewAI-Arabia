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

/** CV parsing is the single most expensive call — a much tighter budget. */
export const heavyAiLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: userOrIpKey,
  message: { error: 'وصلت للحد الأقصى لتحليل السير الذاتية هذه الساعة / CV analysis limit reached for this hour' },
});

/** Checkout creation — stops payment-record spam. */
export const paymentLimiter = rateLimit({
  ...base,
  windowMs: 10 * 60 * 1000,
  max: 8,
  keyGenerator: userOrIpKey,
  message: { error: 'محاولات دفع كثيرة. حاول بعد قليل / Too many payment attempts' },
});
