/**
 * POST /api/contact — the marketing site's contact form.
 *
 * Deliberately unauthenticated: the people most likely to need it are the ones
 * who cannot get into their account. That makes it the one open write endpoint
 * on the service, so it carries its own defences rather than relying on the
 * general limiter:
 *
 *   - a honeypot field, which costs a real visitor nothing
 *   - a hard rate limit per IP
 *   - length caps enforced by the schema, not by the browser
 *   - `replyTo` rather than `from`, so the message is sent BY our mailbox and
 *     merely answers TO the visitor. Putting a stranger's address in `From:`
 *     is what gets a domain's SPF/DKIM reputation destroyed.
 */

import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';

import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { logger } from '../utils/logger.js';
import { sendMail, isConfigured as mailConfigured } from '../services/mail/mailer.js';
import { contactNotificationEmail, contactAckEmail } from '../services/mail/templates.js';
import { cfg } from '../services/secrets/store.js';
import {
  verify as verifyCaptcha,
  siteKey as captchaSiteKey,
  isConfigured as captchaConfigured,
} from '../services/security/recaptcha.js';

const router = Router();

const TOPICS = ['support', 'billing', 'feature', 'business', 'other'];

/** The action name the page must mint its token under. See recaptcha.js. */
const CAPTCHA_ACTION = 'contact';

/**
 * How long a form must have been on screen before a submission is believable.
 *
 * A person cannot read four fields, choose a topic and type ten characters in
 * under three seconds. A script fills them in one tick. This costs nothing to
 * check, needs no third party, and catches the naive bots that never execute
 * the reCAPTCHA JavaScript at all — the majority of them.
 */
const MIN_FILL_MS = 3000;
/** Older than this and the token would be expired anyway; treat as replay. */
const MAX_FILL_MS = 60 * 60 * 1000;

const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(190),
  topic: z.enum(TOPICS).optional().default('other'),
  message: z.string().trim().min(10).max(4000),
  // The honeypot. Present in the payload, invisible in the page.
  website: z.string().max(200).optional().default(''),
  // reCAPTCHA v3 token. Optional in the schema so that a client which cannot
  // reach Google's script still reaches the handler and gets a real error,
  // rather than a 400 that reads like the message itself was malformed.
  captcha: z.string().max(4000).optional().default(''),
  // Milliseconds the form was on screen. Client-supplied and therefore only a
  // filter, never a guarantee — it is one of several layers, not the wall.
  elapsedMs: z.coerce.number().int().min(0).max(86_400_000).optional().default(0),
});

/**
 * GET /api/contact/config — what the page needs to render the form.
 *
 * The site key is public by definition (it is printed into the HTML), but it
 * is served rather than hardcoded so that rotating the key pair is an admin
 * action, not an edit-and-redeploy. `enabled:false` tells the page to submit
 * without a token instead of waiting forever for a script that will not load.
 */
router.get('/config', (_req, res) => {
  res.json({
    recaptcha: captchaConfigured() ? { enabled: true, siteKey: captchaSiteKey(), action: CAPTCHA_ACTION } : { enabled: false },
  });
});

/** Five messages an hour from one address is far past any honest use. */
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'محاولات كثيرة. حاول بعد قليل / Too many messages, try again later' },
});

router.post('/', contactLimiter, asyncHandler(async (req, res) => {
  const body = contactSchema.parse(req.body);

  // A filled honeypot is a bot. Answer exactly as if it worked — telling a
  // scraper it was detected only teaches it to leave the field alone next time.
  if (body.website.trim() !== '') {
    logger.info('contact honeypot tripped');
    return res.json({ ok: true });
  }

  // Filled impossibly fast. Same treatment as the honeypot, and for the same
  // reason: an explicit "you look like a bot" is a free lesson in how to look
  // less like one. A human who somehow trips this can simply send again — the
  // timer restarts with the page.
  if (body.elapsedMs > 0 && (body.elapsedMs < MIN_FILL_MS || body.elapsedMs > MAX_FILL_MS)) {
    logger.info('contact submitted outside plausible window', { elapsedMs: body.elapsedMs });
    return res.json({ ok: true });
  }

  /*
   * reCAPTCHA v3.
   *
   * Deliberately AFTER the two silent filters and BEFORE the mail send: there
   * is no reason to spend a network round-trip on a request the honeypot has
   * already condemned, and no reason to spend an SMTP connection on one the
   * score is about to reject.
   *
   * Unlike the filters above, a failure here IS reported. A score below the
   * threshold can happen to a real person — a hardened browser, a VPN, a shared
   * office IP — and silently swallowing their message while telling them it
   * was sent is the worst outcome available. They are told, and told how to
   * reach us anyway.
   */
  const captcha = await verifyCaptcha(body.captcha, {
    action: CAPTCHA_ACTION,
    ip: req.ip,
  });
  if (!captcha.ok) {
    logger.warn('contact captcha rejected', { reason: captcha.reason, score: captcha.score });
    throw new HttpError(
      403,
      'تعذّر التحقّق من أنك لست روبوتًا. أعد تحميل الصفحة وحاول مرة أخرى، أو راسلنا على info@interprova.com / Could not verify you are human. Reload and try again, or email info@interprova.com',
      undefined,
      'CAPTCHA_FAILED',
    );
  }

  if (!mailConfigured()) {
    logger.error('contact form used but SMTP is not configured');
    throw new HttpError(503, 'نظام الرسائل غير متاح مؤقتًا / Messaging is temporarily unavailable');
  }

  const to = String(cfg('SMTP_USER') || '').trim();

  // The notification is the one that must not fail. It is the message itself;
  // losing it loses the enquiry, so its failure is reported to the sender.
  try {
    await sendMail({
      to,
      replyTo: body.email,
      ...contactNotificationEmail(body),
    });
  } catch (err) {
    logger.error('contact email failed', { message: err.message });
    throw new HttpError(502, 'تعذّر إرسال رسالتك. راسلنا على info@interprova.com / Could not send, please email us directly');
  }

  /*
   * The acknowledgement to the visitor — best-effort, and deliberately after
   * the response is already assured.
   *
   * Not awaited into the error path: their message is already safely in our
   * inbox, and telling them "could not send" because a courtesy copy bounced
   * would make them send it again. A hard bounce here is also completely
   * normal — the address is unverified and may simply not exist.
   */
  sendMail({ to: body.email, ...contactAckEmail(body) })
    .catch((err) => logger.warn('contact acknowledgement failed', { message: err.message }));

  logger.info('contact message sent', { topic: body.topic });
  res.json({ ok: true });
}));

export default router;
