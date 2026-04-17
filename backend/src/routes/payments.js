import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { prisma } from '../db/prisma.js';
import { queryOne } from '../db/mysql.js';
import { requireUser } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';

const router = Router();

/* -------------------------------------------------------------------------
 * Paymob (Egypt) integration — subscription checkout.
 *
 * Flow:
 *  1. Frontend calls POST /api/payments/checkout with { plan: 'monthly'|'yearly' }
 *  2. Backend authenticates to Paymob (auth token), registers an order,
 *     requests a payment key, and returns an iframe URL.
 *  3. User pays on Paymob's hosted iframe.
 *  4. Paymob POSTs /api/payments/webhook (we verify HMAC).
 *  5. On success we activate the user's premium subscription.
 *
 * Config (backend/.env):
 *    PAYMOB_ENABLED=true
 *    PAYMOB_API_KEY=<your API key from Paymob dashboard>
 *    PAYMOB_INTEGRATION_ID=<card integration id>
 *    PAYMOB_IFRAME_ID=<iframe id>
 *    PAYMOB_HMAC_SECRET=<hmac secret for webhook verification>
 * ----------------------------------------------------------------------- */

const PLANS = {
  monthly: { priceEgp: 29,  days: 30,  label: 'شهري',  productId: 'interviewai_monthly' },
  yearly:  { priceEgp: 249, days: 365, label: 'سنوي',  productId: 'interviewai_yearly'  },
};

const BASE_URL = 'https://accept.paymob.com/api';

function ensurePaymobConfigured() {
  const missing = [];
  if (!env.PAYMOB_ENABLED) throw new HttpError(503, 'الدفع غير مفعّل مؤقتًا. تواصل مع الدعم لتفعيله.');
  if (!env.PAYMOB_API_KEY)        missing.push('PAYMOB_API_KEY');
  if (!env.PAYMOB_INTEGRATION_ID) missing.push('PAYMOB_INTEGRATION_ID');
  if (!env.PAYMOB_IFRAME_ID)      missing.push('PAYMOB_IFRAME_ID');
  if (!env.PAYMOB_HMAC_SECRET)    missing.push('PAYMOB_HMAC_SECRET');
  if (missing.length) {
    logger.error('Paymob not fully configured', { missing });
    throw new HttpError(503, 'الدفع غير مكتمل الإعداد. يرجى التواصل مع الدعم.');
  }
}

async function paymobAuth() {
  const res = await fetch(`${BASE_URL}/auth/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: env.PAYMOB_API_KEY }),
  });
  if (!res.ok) throw new Error(`Paymob auth HTTP ${res.status}`);
  const data = await res.json();
  return data.token;
}

async function paymobRegisterOrder({ authToken, amountCents, merchantOrderId }) {
  const res = await fetch(`${BASE_URL}/ecommerce/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_token: authToken,
      delivery_needed: false,
      amount_cents: amountCents,
      currency: 'EGP',
      merchant_order_id: merchantOrderId,
      items: [],
    }),
  });
  if (!res.ok) throw new Error(`Paymob order HTTP ${res.status}`);
  return await res.json();
}

async function paymobPaymentKey({ authToken, amountCents, orderId, billingData, integrationId }) {
  const res = await fetch(`${BASE_URL}/acceptance/payment_keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_token: authToken,
      amount_cents: amountCents,
      expiration: 3600,
      order_id: orderId,
      billing_data: billingData,
      currency: 'EGP',
      integration_id: Number(integrationId),
      lock_order_when_paid: true,
    }),
  });
  if (!res.ok) throw new Error(`Paymob payment key HTTP ${res.status}`);
  const data = await res.json();
  return data.token;
}

/* --------------------- POST /api/payments/checkout --------------------- */

const checkoutSchema = z.object({
  plan: z.enum(['monthly', 'yearly']),
});

router.post('/checkout', requireUser, asyncHandler(async (req, res) => {
  ensurePaymobConfigured();
  const { plan } = checkoutSchema.parse(req.body);
  const planSpec = PLANS[plan];

  const user = await queryOne(
    'SELECT id, email, name FROM users WHERE id = ?',
    [req.userId.toString()]
  );
  if (!user) throw new HttpError(404, 'User not found');

  // Unique merchant_order_id per attempt — let Paymob reject duplicates.
  const merchantOrderId = `iaa-${user.id}-${plan}-${Date.now()}`;
  const amountCents = planSpec.priceEgp * 100;

  const authToken = await paymobAuth();
  const order = await paymobRegisterOrder({ authToken, amountCents, merchantOrderId });

  // Minimal billing data satisfies Paymob's required fields.
  const [firstName, ...rest] = (user.name || 'User').split(' ');
  const billingData = {
    apartment: 'NA', email: user.email, floor: 'NA',
    first_name: firstName || 'User',
    last_name: rest.join(' ') || 'Account',
    street: 'NA', building: 'NA', phone_number: '+201000000000',
    shipping_method: 'NA', postal_code: 'NA',
    city: 'Cairo', country: 'EG', state: 'NA',
  };

  const paymentToken = await paymobPaymentKey({
    authToken, amountCents, orderId: order.id,
    billingData, integrationId: env.PAYMOB_INTEGRATION_ID,
  });

  const iframeUrl = `https://accept.paymob.com/api/acceptance/iframes/${env.PAYMOB_IFRAME_ID}?payment_token=${paymentToken}`;

  // Persist a pending subscription record so we can match the webhook later.
  await prisma.subscription.create({
    data: {
      userId: req.userId,
      googlePurchaseToken: merchantOrderId, // reuse the column as external order id
      productId: planSpec.productId,
      status: 'expired', // will be flipped to 'active' on successful webhook
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + planSpec.days * 86400_000),
      rawPayload: JSON.stringify({ paymob_order_id: order.id, plan, amountCents, pending: true }),
    },
  });

  res.json({
    iframeUrl,
    paymobOrderId: order.id,
    merchantOrderId,
    amountCents,
    plan,
  });
}));

/* --------------------- POST /api/payments/webhook --------------------- */

// Paymob's HMAC signs a specific concatenation of fields in a fixed order.
// Full list: https://developers.paymob.com/egypt/getting-started-egy/transaction-response-callbacks
const HMAC_FIELDS = [
  'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction',
  'id', 'integration_id', 'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded',
  'is_standalone_payment', 'is_voided', 'order.id', 'owner', 'pending',
  'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success',
];

function pick(obj, path) {
  return path.split('.').reduce((o, k) => (o && o[k] !== undefined) ? o[k] : '', obj);
}

function verifyHmac(payload, signature) {
  const concat = HMAC_FIELDS.map((p) => String(pick(payload, p))).join('');
  const expected = crypto.createHmac('sha512', env.PAYMOB_HMAC_SECRET).update(concat).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ''));
}

router.post('/webhook', asyncHandler(async (req, res) => {
  if (!env.PAYMOB_ENABLED || !env.PAYMOB_HMAC_SECRET) {
    logger.warn('Paymob webhook hit but gateway disabled');
    return res.status(200).json({ ok: true, ignored: true });
  }

  const hmac = req.query.hmac || req.body?.hmac;
  const data = req.body?.obj || req.body;
  if (!data) return res.status(400).json({ error: 'bad payload' });

  let valid = false;
  try { valid = verifyHmac(data, hmac); } catch { valid = false; }
  if (!valid) {
    logger.warn('Paymob webhook HMAC mismatch', { hmac });
    return res.status(403).json({ error: 'invalid hmac' });
  }

  const merchantOrderId = data?.order?.merchant_order_id || '';
  const success = data?.success === true;
  const amountCents = Number(data?.amount_cents || 0);

  const sub = await prisma.subscription.findUnique({ where: { googlePurchaseToken: merchantOrderId } });
  if (!sub) {
    logger.warn('Paymob webhook: no matching subscription', { merchantOrderId });
    return res.status(200).json({ ok: true, matched: false });
  }

  if (success) {
    await prisma.$transaction([
      prisma.subscription.update({
        where: { id: sub.id },
        data: {
          status: 'active',
          rawPayload: JSON.stringify({ ...JSON.parse(sub.rawPayload || '{}'), paid_at: new Date().toISOString(), amountCents }),
        },
      }),
      prisma.user.update({ where: { id: sub.userId }, data: { plan: 'premium' } }),
    ]);
    logger.info('Paymob payment confirmed', { userId: sub.userId.toString(), merchantOrderId });
  } else {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'cancelled' },
    });
    logger.info('Paymob payment failed', { merchantOrderId, errorReason: data?.data?.message });
  }

  res.status(200).json({ ok: true });
}));

/* --------------------- GET /api/payments/config --------------------- */
// Lightweight endpoint so the frontend can show plan pricing / enablement.

router.get('/config', asyncHandler(async (_req, res) => {
  res.json({
    provider: 'paymob',
    enabled: !!env.PAYMOB_ENABLED,
    currency: 'EGP',
    plans: {
      monthly: { ...PLANS.monthly },
      yearly:  { ...PLANS.yearly },
    },
  });
}));

export default router;
