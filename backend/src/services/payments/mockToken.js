/**
 * The capability token for the mock checkout.
 *
 * Mock mode exists so the whole payment flow — checkout, redirect, callback,
 * fulfilment — can be exercised before EasyKash credentials exist. The page it
 * serves is opened in a browser, which carries no Authorization header, so the
 * completion endpoint cannot be protected with requireUser and was protected
 * with nothing at all: a `reference` in a form body was enough to run the real
 * fulfilment path and credit real minutes, from any caller, for any user.
 *
 * A reference is not a secret — it is echoed in the return URL's query string,
 * so anyone who sees a browser history can read one. This is: an HMAC over the
 * reference under JWT_SECRET, handed only to the authenticated user who created
 * the checkout, as part of the URL they are redirected to. Holding a reference
 * is no longer enough to complete somebody else's payment.
 *
 * It is the SECOND lock. The first is that env.js refuses to enable mock mode
 * in production at all.
 */

import crypto from 'node:crypto';
import { env } from '../../config/env.js';

function sign(reference) {
  return crypto
    .createHmac('sha256', env.JWT_SECRET || 'iaa-mock-token-salt')
    .update(`mock-checkout:${String(reference)}`)
    .digest('hex')
    .slice(0, 32);
}

export const mockToken = sign;

/** Constant-time compare, length-guarded — timingSafeEqual throws otherwise. */
export function mockTokenValid(reference, provided) {
  if (!reference || !provided) return false;
  const a = Buffer.from(sign(reference));
  const b = Buffer.from(String(provided));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
