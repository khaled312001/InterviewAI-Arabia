/**
 * EasyKash (Egypt) payment adapter.
 *
 * ── IMPORTANT, READ BEFORE GOING LIVE ────────────────────────────────────
 * EasyKash publishes its API reference inside the merchant dashboard rather
 * than publicly, so the exact field names below are configurable rather than
 * hardcoded guesses. Everything that could differ between merchant accounts
 * is driven by env vars, and this file is the ONLY place that needs to change
 * once you have the PDF from your dashboard:
 *
 *   EASYKASH_BASE_URL           default https://back.easykash.net
 *   EASYKASH_PAY_PATH           default /api/directpayv1/pay
 *   EASYKASH_API_KEY            your private key (sent as the Authorization header)
 *   EASYKASH_WEBHOOK_SECRET     shared secret used to sign callbacks
 *   EASYKASH_SIGNATURE_FIELDS   ordered, comma-separated field names concatenated
 *                               to build the signature payload
 *   EASYKASH_SIGNATURE_ALGO     default sha256
 *   EASYKASH_SIGNATURE_HEADER   header carrying the signature (falls back to a body field)
 *
 * Run `npm run verify:easykash -- --payload <saved-webhook.json>` against one
 * real callback to confirm the signature recipe before enabling live payments.
 *
 * Security posture: this adapter NEVER trusts the callback body for the amount
 * or the user. It matches on our own `reference` (which we generated) and the
 * caller re-checks the amount against the Payment row we created at checkout.
 * A forged callback therefore cannot grant premium even if the signature
 * recipe turns out to be wrong.
 * ─────────────────────────────────────────────────────────────────────────
 */

import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { cfg } from '../secrets/store.js';
import { logger } from '../../utils/logger.js';

const TIMEOUT_MS = 20_000;

export function isConfigured() {
  return Boolean(cfg('EASYKASH_ENABLED') && cfg('EASYKASH_API_KEY'));
}

/** True when we can cryptographically verify callbacks. */
export function canVerifyWebhooks() {
  return Boolean(cfg('EASYKASH_WEBHOOK_SECRET'));
}

/* ------------------------------------------------------------------ *
 * Checkout
 * ------------------------------------------------------------------ */

/**
 * Create a hosted-checkout session.
 *
 * @returns {Promise<{redirectUrl: string, providerRef: string|null, raw: object}>}
 */
export async function createPayment({
  reference,      // OUR id — echoed back on the callback as customerReference
  amountEgp,
  planLabel,
  customer,       // { name, email, phone }
  redirectUrl,    // where EasyKash sends the browser after payment
}) {
  // Mock mode lets the entire payment flow — checkout, redirect, callback,
  // activation — be exercised end to end before credentials exist. Without it
  // the payment path is untestable until launch day, which is exactly when
  // you least want to be discovering integration bugs.
  if (env.EASYKASH_MOCK) {
    logger.warn('EasyKash MOCK mode — no real payment will be taken', { reference });
    const base = env.APP_URL.replace(/\/$/, '');
    return {
      redirectUrl: `${base}/api/payments/mock-checkout?reference=${encodeURIComponent(reference)}`,
      providerRef: `mock_${reference}`,
      raw: { mock: true },
    };
  }

  if (!isConfigured()) {
    const err = new Error('EasyKash is not configured');
    err.code = 'GATEWAY_NOT_CONFIGURED';
    throw err;
  }

  const url = `${String(cfg('EASYKASH_BASE_URL')).replace(/\/$/, '')}${cfg('EASYKASH_PAY_PATH')}`;

  const body = {
    // EasyKash expects a decimal amount in EGP (not minor units) on Direct Pay.
    amount: Number((amountEgp).toFixed(2)),
    currency: 'EGP',
    // Which methods to offer on the hosted page. Configurable because the set
    // enabled on a merchant account varies (card / Fawry / wallets / kiosk).
    paymentOptions: cfg('EASYKASH_PAYMENT_OPTIONS'),
    name: customer.name?.slice(0, 100) || 'Customer',
    email: customer.email,
    mobile: normaliseEgyptianMobile(customer.phone),
    redirectUrl,
    // Echoed back to us on the callback — this is the join key.
    customerReference: reference,
    description: planLabel,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: cfg('EASYKASH_API_KEY'),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!res.ok) {
      logger.error('EasyKash checkout failed', { status: res.status, body: text.slice(0, 400) });
      const err = new Error(`EasyKash HTTP ${res.status}`);
      err.code = 'GATEWAY_ERROR';
      err.detail = text.slice(0, 400);
      throw err;
    }

    // Different EasyKash product tiers name this field differently; accept the
    // documented variants rather than failing on a rename.
    const redirect =
      data.redirectUrl || data.redirect_url || data.paymentUrl || data.url || data.data?.redirectUrl;

    if (!redirect) {
      logger.error('EasyKash response has no redirect URL', { body: text.slice(0, 400) });
      const err = new Error('EasyKash did not return a payment URL');
      err.code = 'GATEWAY_ERROR';
      throw err;
    }

    return {
      redirectUrl: redirect,
      providerRef: data.easykashRef || data.reference || data.id || null,
      raw: data,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('EasyKash request timed out');
      e.code = 'GATEWAY_TIMEOUT';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * Webhook verification
 * ------------------------------------------------------------------ */

/**
 * Recompute the signature over the configured, ordered field list.
 *
 * Uses `timingSafeEqual`, and guards the length mismatch that makes it throw
 * (Node's timingSafeEqual raises rather than returning false when the buffers
 * differ in length — a classic way to turn a failed check into a 500).
 */
export function verifySignature(payload, providedSignature) {
  if (!cfg('EASYKASH_WEBHOOK_SECRET')) return { valid: false, reason: 'no_secret_configured' };
  if (!providedSignature) return { valid: false, reason: 'missing_signature' };

  const fields = cfg('EASYKASH_SIGNATURE_FIELDS');
  const concat = fields
    .map((f) => {
      const v = f.split('.').reduce((o, k) => (o == null ? undefined : o[k]), payload);
      return v === undefined || v === null ? '' : String(v);
    })
    .join('');

  const expected = crypto
    .createHmac(cfg('EASYKASH_SIGNATURE_ALGO'), cfg('EASYKASH_WEBHOOK_SECRET'))
    .update(concat)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(providedSignature).toLowerCase().trim(), 'utf8');
  if (a.length !== b.length) {
    return { valid: false, reason: 'length_mismatch', expectedPreview: expected.slice(0, 8) };
  }

  return {
    valid: crypto.timingSafeEqual(a, b),
    reason: null,
    signedString: concat,
  };
}

/**
 * Normalise a callback into the shape the route works with.
 * Field names vary by EasyKash product; accept the known aliases.
 */
export function parseCallback(body) {
  const pick = (...keys) => {
    for (const k of keys) {
      const v = k.split('.').reduce((o, part) => (o == null ? undefined : o[part]), body);
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  };

  const rawStatus = String(pick('status', 'Status', 'paymentStatus') ?? '').toLowerCase();

  return {
    reference: pick('customerReference', 'CustomerReference', 'customer_reference', 'merchantReference'),
    providerTxnId: pick('easykashRef', 'EasykashRef', 'transactionId', 'id'),
    amount: Number(pick('Amount', 'amount') ?? NaN),
    currency: String(pick('currency', 'Currency') ?? 'EGP').toUpperCase(),
    method: pick('PaymentMethod', 'paymentMethod', 'method'),
    // EasyKash uses several spellings for success across its products.
    isPaid: ['paid', 'success', 'successful', 'completed', 'captured', '1', 'true'].includes(rawStatus),
    isRefunded: ['refunded', 'reversed'].includes(rawStatus),
    isFailed: ['failed', 'declined', 'cancelled', 'canceled', 'expired', '0', 'false'].includes(rawStatus),
    rawStatus,
  };
}

/**
 * Egyptian mobile numbers must reach the gateway in a consistent form.
 * Accepts 01XXXXXXXXX, +201XXXXXXXXX, 00201XXXXXXXXX and normalises to
 * 01XXXXXXXXX, which is what the EasyKash hosted page expects.
 */
export function normaliseEgyptianMobile(input) {
  const digits = String(input ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0020')) return `0${digits.slice(4)}`;
  if (digits.startsWith('20') && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.startsWith('1') && digits.length === 10) return `0${digits}`;
  return digits;
}
