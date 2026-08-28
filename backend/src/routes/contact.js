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
import { cfg } from '../services/secrets/store.js';

const router = Router();

const TOPICS = ['support', 'billing', 'feature', 'business', 'other'];

const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(190),
  topic: z.enum(TOPICS).optional().default('other'),
  message: z.string().trim().min(10).max(4000),
  // The honeypot. Present in the payload, invisible in the page.
  website: z.string().max(200).optional().default(''),
});

/** Five messages an hour from one address is far past any honest use. */
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'محاولات كثيرة. حاول بعد قليل / Too many messages, try again later' },
});

/** Escape for interpolation into the HTML body of the notification email. */
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

router.post('/', contactLimiter, asyncHandler(async (req, res) => {
  const body = contactSchema.parse(req.body);

  // A filled honeypot is a bot. Answer exactly as if it worked — telling a
  // scraper it was detected only teaches it to leave the field alone next time.
  if (body.website.trim() !== '') {
    logger.info('contact honeypot tripped');
    return res.json({ ok: true });
  }

  if (!mailConfigured()) {
    logger.error('contact form used but SMTP is not configured');
    throw new HttpError(503, 'نظام الرسائل غير متاح مؤقتًا / Messaging is temporarily unavailable');
  }

  const to = String(cfg('SMTP_USER') || '').trim();
  const subject = `[Interprova · ${body.topic}] ${body.name}`;

  const text = [
    `Topic  : ${body.topic}`,
    `Name   : ${body.name}`,
    `Email  : ${body.email}`,
    '',
    body.message,
  ].join('\n');

  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;line-height:1.7;color:#0F172A">
      <p style="margin:0 0 4px"><strong>Topic:</strong> ${esc(body.topic)}</p>
      <p style="margin:0 0 4px"><strong>Name:</strong> ${esc(body.name)}</p>
      <p style="margin:0 0 16px"><strong>Email:</strong> ${esc(body.email)}</p>
      <div style="padding:14px 16px;background:#F7F9FC;border-radius:10px;white-space:pre-wrap">${esc(body.message)}</div>
    </div>`;

  try {
    await sendMail({ to, subject, text, html, replyTo: body.email });
  } catch (err) {
    logger.error('contact email failed', { message: err.message });
    throw new HttpError(502, 'تعذّر إرسال رسالتك. راسلنا على info@interprova.com / Could not send, please email us directly');
  }

  logger.info('contact message sent', { topic: body.topic });
  res.json({ ok: true });
}));

export default router;
