import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { prisma } from '../db/prisma.js';
import { requireUser } from '../middleware/auth.js';
import { paymentLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { PLANS, getPlan, planList, computeExpiry } from '../services/payments/plans.js';
import * as easykash from '../services/payments/easykash.js';
import { cfg } from '../services/secrets/store.js';

const router = Router();

/* -------------------------------------------------------------------------
 * GET /api/payments/config — what the paywall renders.
 * ---------------------------------------------------------------------- */

router.get('/config', asyncHandler(async (_req, res) => {
  res.json({
    provider: 'easykash',
    enabled: easykash.isConfigured() || env.EASYKASH_MOCK,
    mock: env.EASYKASH_MOCK,
    currency: 'EGP',
    plans: planList(),
  });
}));

/* -------------------------------------------------------------------------
 * POST /api/payments/checkout
 *
 * Creates a `pending` Payment row FIRST, then asks the gateway for a hosted
 * checkout URL. Creating our own record up front is what makes the callback
 * verifiable: we know the reference, the exact amount, and the user, so a
 * forged callback cannot invent any of them.
 * ---------------------------------------------------------------------- */

const checkoutSchema = z.object({
  plan: z.enum(Object.keys(PLANS)),
  // EasyKash requires a mobile number. Collected here if we don't have one.
  phone: z.string().min(8).max(20).optional(),
});

router.post('/checkout', requireUser, paymentLimiter, asyncHandler(async (req, res) => {
  const { plan: planCode, phone } = checkoutSchema.parse(req.body);
  const plan = getPlan(planCode);

  if (!easykash.isConfigured() && !env.EASYKASH_MOCK) {
    throw new HttpError(503, 'الدفع غير مفعّل حاليًا. تواصل مع الدعم / Payments are not enabled yet');
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new HttpError(404, 'User not found');

  const mobile = easykash.normaliseEgyptianMobile(phone || user.phone);
  if (!mobile) {
    throw new HttpError(400, 'رقم الموبايل مطلوب لإتمام الدفع / A mobile number is required to pay', {
      field: 'phone',
    });
  }
  if (phone && phone !== user.phone) {
    await prisma.user.update({ where: { id: user.id }, data: { phone: mobile } });
  }

  // Unguessable, unique, and ours. Used as the join key on the callback.
  const reference = `iaa_${user.id}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;

  const payment = await prisma.payment.create({
    data: {
      userId: user.id,
      provider: 'easykash',
      reference,
      planCode: plan.code,
      amountCents: plan.amountCents,
      currency: 'EGP',
      status: 'pending',
    },
  });

  try {
    const { redirectUrl, providerRef, raw } = await easykash.createPayment({
      reference,
      amountEgp: plan.amountCents / 100,
      planLabel: `InterviewAI ${plan.labelEn}`,
      customer: { name: user.name, email: user.email, phone: mobile },
      redirectUrl: `${env.APP_URL.replace(/\/$/, '')}/api/payments/return?reference=${encodeURIComponent(reference)}`,
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: { providerTxnId: providerRef, rawPayload: JSON.stringify(raw).slice(0, 60000) },
    });

    res.status(201).json({
      reference,
      redirectUrl,
      plan: { code: plan.code, amountEgp: plan.amountCents / 100, days: plan.days },
    });
  } catch (err) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'failed', failureReason: String(err.message).slice(0, 500) },
    });
    logger.error('Checkout failed', { reference, code: err.code, message: err.message });
    throw new HttpError(502, 'تعذّر بدء عملية الدفع. حاول مرة أخرى / Could not start the payment');
  }
}));

/* -------------------------------------------------------------------------
 * POST /api/payments/webhook — the only path that grants premium.
 * ---------------------------------------------------------------------- */

router.post('/webhook', asyncHandler(async (req, res) => {
  const body = req.body ?? {};

  // Always ACK quickly. Gateways retry on non-2xx, and retrying a request we
  // have already recorded just amplifies load; failures are recorded on the
  // WebhookEvent row for inspection instead.
  const ack = (extra = {}) => res.status(200).json({ ok: true, ...extra });

  if (!easykash.isConfigured() && !env.EASYKASH_MOCK) {
    logger.warn('EasyKash webhook received while gateway disabled');
    return ack({ ignored: true });
  }

  const parsed = easykash.parseCallback(body);

  // Idempotency: one row per (provider, external id). A replayed success
  // payload previously re-granted a month of premium and could silently undo
  // an admin refund.
  const externalId = String(
    parsed.providerTxnId ||
    crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex'),
  ).slice(0, 191);

  let event;
  try {
    event = await prisma.webhookEvent.create({
      data: { provider: 'easykash', externalId, payload: JSON.stringify(body).slice(0, 60000) },
    });
  } catch (e) {
    // Unique violation → already seen.
    if (e.code === 'P2002') {
      logger.info('Duplicate EasyKash webhook ignored', { externalId });
      return ack({ duplicate: true });
    }
    throw e;
  }

  const fail = async (reason) => {
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { error: reason.slice(0, 500), processedAt: new Date() },
    });
    logger.warn('EasyKash webhook rejected', { externalId, reason });
    return ack({ accepted: false, reason });
  };

  // Signature. Mandatory whenever a secret is configured; refusing to verify
  // is not an option in production.
  if (easykash.canVerifyWebhooks()) {
    const sigHeader = cfg('EASYKASH_SIGNATURE_HEADER');
    const provided =
      (sigHeader && req.get(sigHeader)) ||
      body.signatureHash || body.signature || body.hmac;
    const check = easykash.verifySignature(body, provided);
    if (!check.valid) return fail(`invalid_signature:${check.reason || 'mismatch'}`);
  } else if (env.isProd && !env.EASYKASH_MOCK) {
    return fail('webhook_secret_not_configured');
  }

  if (!parsed.reference) return fail('missing_customer_reference');

  const payment = await prisma.payment.findUnique({
    where: { reference: String(parsed.reference) },
    include: { user: true },
  });
  if (!payment) return fail(`unknown_reference:${parsed.reference}`);

  // Amount check. Without it, a gateway misconfiguration (or a tampered hosted
  // page) could activate a 1199 EGP yearly plan for 1 EGP.
  if (Number.isFinite(parsed.amount)) {
    const paidCents = Math.round(parsed.amount * 100);
    if (paidCents < payment.amountCents) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'failed',
          failureReason: `underpaid: got ${paidCents}, expected ${payment.amountCents}`,
          rawPayload: JSON.stringify(body).slice(0, 60000),
        },
      });
      return fail(`amount_mismatch:${paidCents}<${payment.amountCents}`);
    }
  }
  if (parsed.currency && parsed.currency !== payment.currency) {
    return fail(`currency_mismatch:${parsed.currency}`);
  }

  if (parsed.isRefunded) {
    await handleRefund(payment, body);
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    return ack({ handled: 'refund' });
  }

  if (!parsed.isPaid) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: parsed.isFailed ? 'failed' : 'pending',
        method: parsed.method ?? undefined,
        failureReason: parsed.isFailed ? `gateway_status:${parsed.rawStatus}` : null,
        rawPayload: JSON.stringify(body).slice(0, 60000),
      },
    });
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    return ack({ handled: parsed.isFailed ? 'failed' : 'pending' });
  }

  // Already settled — nothing to do, and specifically do NOT re-extend.
  if (payment.status === 'paid') {
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    return ack({ handled: 'already_paid' });
  }

  await activateSubscription({ payment, parsed, body });
  await prisma.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
  return ack({ handled: 'activated' });
}));

/* ------------------------------------------------------------------ *
 * Activation / refund
 * ------------------------------------------------------------------ */

async function activateSubscription({ payment, parsed, body }) {
  const plan = getPlan(payment.planCode);
  const now = new Date();

  // Extend from the user's CURRENT expiry when it is still in the future, so
  // renewing early adds time instead of destroying it.
  const current = await prisma.subscription.findFirst({
    where: { userId: payment.userId, status: 'active' },
    orderBy: { expiresAt: 'desc' },
  });
  const expiresAt = computeExpiry({
    currentExpiresAt: current?.expiresAt ?? null,
    days: plan.days,
    now,
  });

  await prisma.$transaction(async (tx) => {
    const subscription = await tx.subscription.upsert({
      where: { providerRef: payment.reference },
      create: {
        userId: payment.userId,
        provider: 'easykash',
        providerRef: payment.reference,
        planCode: plan.code,
        status: 'active',
        startedAt: now,
        expiresAt,
        rawPayload: JSON.stringify(body).slice(0, 60000),
      },
      update: { status: 'active', expiresAt },
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'paid',
        paidAt: now,
        method: parsed.method ?? undefined,
        providerTxnId: parsed.providerTxnId ? String(parsed.providerTxnId) : payment.providerTxnId,
        subscriptionId: subscription.id,
        rawPayload: JSON.stringify(body).slice(0, 60000),
      },
    });

    // Supersede any older active subscription so `status` resolution is
    // unambiguous and the expiry sweep can't downgrade a paying user.
    await tx.subscription.updateMany({
      where: { userId: payment.userId, status: 'active', id: { not: subscription.id } },
      data: { status: 'expired' },
    });

    await tx.user.update({
      where: { id: payment.userId },
      data: { plan: 'premium', premiumUntil: expiresAt },
    });
  });

  logger.info('Subscription activated', {
    userId: payment.userId.toString(),
    plan: plan.code,
    reference: payment.reference,
    expiresAt: expiresAt.toISOString(),
    amountCents: payment.amountCents,
  });
}

async function handleRefund(payment, body) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'refunded', refundedAt: now, rawPayload: JSON.stringify(body).slice(0, 60000) },
    });

    const sub = await tx.subscription.findUnique({ where: { providerRef: payment.reference } });
    if (sub) {
      await tx.subscription.update({
        where: { id: sub.id },
        data: { status: 'refunded', cancelledAt: now },
      });
    }

    // Only drop the user to free if no OTHER active subscription covers them.
    const stillCovered = await tx.subscription.findFirst({
      where: {
        userId: payment.userId,
        status: 'active',
        expiresAt: { gt: now },
        ...(sub ? { id: { not: sub.id } } : {}),
      },
      orderBy: { expiresAt: 'desc' },
    });

    await tx.user.update({
      where: { id: payment.userId },
      data: stillCovered
        ? { plan: 'premium', premiumUntil: stillCovered.expiresAt }
        : { plan: 'free', premiumUntil: null },
    });
  });

  logger.info('Payment refunded', { reference: payment.reference });
}

/* -------------------------------------------------------------------------
 * GET /api/payments/return — where the gateway sends the browser back.
 * ---------------------------------------------------------------------- */

router.get('/return', asyncHandler(async (req, res) => {
  const reference = String(req.query.reference || '');
  const payment = reference
    ? await prisma.payment.findUnique({ where: { reference } })
    : null;

  // The webhook is the source of truth and may not have landed yet, so the
  // client polls /subscriptions/status rather than trusting this redirect.
  const status = payment?.status ?? 'unknown';
  const target = `${env.APP_URL.replace(/\/$/, '')}/subscription?payment=${status}&ref=${encodeURIComponent(reference)}`;
  res.redirect(302, target);
}));

/* -------------------------------------------------------------------------
 * GET /api/payments/status/:reference — client polls this after returning.
 * ---------------------------------------------------------------------- */

router.get('/status/:reference', requireUser, asyncHandler(async (req, res) => {
  const payment = await prisma.payment.findUnique({
    where: { reference: req.params.reference },
  });
  if (!payment || payment.userId !== req.userId) throw new HttpError(404, 'Payment not found');
  res.json({
    reference: payment.reference,
    status: payment.status,
    planCode: payment.planCode,
    amountEgp: payment.amountCents / 100,
    paidAt: payment.paidAt,
  });
}));

/* -------------------------------------------------------------------------
 * Mock checkout — only mounted when EASYKASH_MOCK is on. Lets the whole
 * payment→activation flow be tested before credentials exist.
 * ---------------------------------------------------------------------- */

if (env.EASYKASH_MOCK) {
  router.get('/mock-checkout', asyncHandler(async (req, res) => {
    const reference = String(req.query.reference || '');
    const payment = await prisma.payment.findUnique({ where: { reference } });
    if (!payment) throw new HttpError(404, 'Unknown reference');

    res.type('html').send(`<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>محاكاة الدفع</title>
<style>
 body{font-family:system-ui,sans-serif;background:#0F172A;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}
 .c{background:#1E293B;padding:32px;border-radius:18px;max-width:420px;width:90%;text-align:center}
 h1{font-size:20px;margin:0 0 8px} p{color:#94A3B8;margin:0 0 24px;line-height:1.7}
 b{color:#FBBF24;font-size:24px}
 button{width:100%;padding:14px;border:0;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;margin-top:10px}
 .ok{background:#22C55E;color:#052e16}.no{background:#334155;color:#e2e8f0}
</style></head><body><div class="c">
<h1>وضع المحاكاة — لا يوجد دفع حقيقي</h1>
<p>الخطة: ${payment.planCode}<br><b>${(payment.amountCents / 100).toFixed(2)} ج.م</b></p>
<form method="POST" action="/api/payments/mock-complete">
  <input type="hidden" name="reference" value="${reference}">
  <button class="ok" name="outcome" value="paid" type="submit">تأكيد الدفع بنجاح</button>
  <button class="no" name="outcome" value="failed" type="submit">محاكاة فشل الدفع</button>
</form></div></body></html>`);
  }));

  router.post('/mock-complete', asyncHandler(async (req, res) => {
    const reference = String(req.body.reference || '');
    const outcome = String(req.body.outcome || 'paid');
    const payment = await prisma.payment.findUnique({ where: { reference } });
    if (!payment) throw new HttpError(404, 'Unknown reference');

    if (outcome === 'paid' && payment.status !== 'paid') {
      await activateSubscription({
        payment,
        parsed: { method: 'mock', providerTxnId: `mock_${reference}` },
        body: { mock: true },
      });
    } else if (outcome !== 'paid') {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'failed', failureReason: 'mock_failed' },
      });
    }
    res.redirect(302, `/api/payments/return?reference=${encodeURIComponent(reference)}`);
  }));
}

export default router;
