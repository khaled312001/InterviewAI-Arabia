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
  let addr = ip.startsWith('::ffff:') ? ip.slice(7) : ip;   // IPv4-mapped
  // Some proxies append the source port. Left alone it becomes part of the key
  // and every connection from one client lands in its own bucket.
  const withPort = /^(\d+\.\d+\.\d+\.\d+):\d+$/.exec(addr);
  if (withPort) addr = withPort[1];
  if (!addr.includes(':')) return addr;                      // IPv4
  const parts = addr.split(':');
  return `${parts.slice(0, 4).join(':')}::/64`;
}

/**
 * Headers a fronting proxy may use to carry the ORIGINAL caller's address,
 * most specific first. X-Forwarded-For is consulted last because it is a list
 * any hop may append to — and because on this deployment it turned out not to
 * contain the client at all.
 */
const CLIENT_IP_HEADERS = [
  'cf-connecting-ip',   // Cloudflare
  'true-client-ip',     // Akamai, Cloudflare Enterprise
  'x-real-ip',          // nginx, LiteSpeed
  'x-client-ip',
];

/**
 * The caller's own address, as opposed to the proxy that forwarded it.
 *
 * `req.ip` is not usable as a rate-limit key on this deployment. `trust proxy`
 * is pinned at ONE hop in app.js, deliberately, so that a request cannot forge
 * its own req.ip — but production sits behind Hostinger's CDN *and* LiteSpeed,
 * which is two. So req.ip resolves to the CDN edge and every visitor on earth
 * shares one bucket.
 *
 * That was not a subtle degradation. On 2026-08-29 the whole API answered 429
 * to everybody: the general limiter's 200 requests per minute were spent in
 * about nine seconds, and authLimiter's ten login attempts per fifteen minutes
 * were ten attempts for the entire internet combined.
 *
 * Every header here is forgeable, and that is accepted: forging one moves the
 * forger into a DIFFERENT rate-limit bucket, which anyone can already reach by
 * changing IP. It buys nothing and it restores per-client limits for everyone
 * honest. Nothing security-sensitive keys off this value — cron auth is a
 * mandatory constant-time secret and stopped being an address check long ago.
 *
 * middleware/auditLog.js has a narrower version as `clientIp`. It is not
 * imported here on purpose: this file has no dependency but the limiter, and
 * it is loaded on the very first request.
 */
function clientAddress(req) {
  const headers = req.headers || {};
  for (const name of CLIENT_IP_HEADERS) {
    const v = headers[name];
    if (typeof v === 'string' && v.trim()) return v.split(',')[0].trim();
  }
  const forwarded = headers['x-forwarded-for'];
  const first = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : null;
  return first || req.ip;
}

/**
 * The account a request belongs to, read from the bearer token WITHOUT
 * verifying it.
 *
 * `userOrIpKey` reads `req.userId`, which the auth middleware sets — but the
 * general limiter is mounted on /api in app.js, ahead of every route and so
 * ahead of every `requireUser`. `req.userId` was therefore ALWAYS undefined
 * there, and the per-user branch never once ran on the limiter that covers the
 * whole API. Signed-in traffic — the balance poll, the meeting heartbeat, the
 * answer submissions — was all being counted against the anonymous bucket.
 *
 * Not verifying the signature is deliberate and safe. The only thing this
 * value decides is which rate-limit bucket a request lands in, and a forged
 * `sub` merely picks a different one. Authentication still happens later, in
 * the middleware that actually verifies.
 */
function bearerSubject(req) {
  const header = req.headers?.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const parts = header.slice(7).trim().split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload?.sub) return null;
    return `${payload.type === 'admin' ? 'a' : 'u'}:${payload.sub}`;
  } catch {
    return null;   // not a token we can read; fall back to the address
  }
}

/** Per-account when we can tell whose it is; per-client-address otherwise. */
function userOrIpKey(req) {
  if (req.userId) return `u:${req.userId}`;
  if (req.admin?.id) return `a:${req.admin.id}`;
  // Limiters mounted ahead of the auth middleware have neither, but they do
  // have the token. See bearerSubject.
  const subject = bearerSubject(req);
  if (subject) return subject;
  return normaliseIp(clientAddress(req));
}

const base = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
};

/**
 * Login / register / password reset — brute-force protection.
 *
 * Keyed on the ACCOUNT being attempted, not on where the attempt came from.
 * That is the stronger key on its own terms — guessing one password is an
 * attack on one account, and an attacker who rotates IPs defeats an address
 * key entirely while this one still counts every guess. It is also the only
 * key that works here: the address behind this proxy chain was the same value
 * for every caller, so ten attempts per fifteen minutes was ten attempts for
 * the whole internet, and nobody could sign in once a stranger had mistyped a
 * password ten times.
 *
 * Requests with no email in the body (a refresh, a malformed post) fall back
 * to the address.
 */
export const authLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => {
    const email = req.body?.email;
    if (typeof email === 'string' && email.trim()) return `e:${email.trim().toLowerCase()}`;
    return normaliseIp(clientAddress(req));
  },
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
  keyGenerator: (req) => normaliseIp(clientAddress(req)),
  message: { error: 'محاولات تسجيل كثيرة. حاول بعد ساعة / Too many sign-ups from this network, try again in an hour' },
});

/** Blanket limit for the whole API. */
export const generalLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  max: 200,
  keyGenerator: userOrIpKey,
  // The health check answers regardless. A monitor exists to say whether the
  // service is up, and one that is itself rate limited reports an outage that
  // is not happening — while its polling helps cause the one that is.
  skip: (req) => req.path === '/health',
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
