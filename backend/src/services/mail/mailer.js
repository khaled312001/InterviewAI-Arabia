/**
 * Outbound email.
 *
 * One transport, created lazily and reused. Nodemailer pools connections, and
 * building a fresh transport per message means a fresh TLS handshake per
 * message — on a shared host that is most of the latency and, at volume, the
 * thing that gets a sender rate-limited.
 *
 * Configuration comes through `cfg()` like every other credential, so the
 * mailbox can be changed from the admin panel without a deploy. The transport
 * is therefore cached against the settings it was built from and rebuilt when
 * they change; caching it forever is how an operator "fixes" a password in the
 * panel and watches delivery keep failing until someone restarts the process.
 */

import nodemailer from 'nodemailer';
import { cfg } from '../secrets/store.js';
import { logger } from '../../utils/logger.js';

/** Fail fast rather than hold a request open behind a dead mail server. */
const TIMEOUT_MS = 10_000;

let cached = null;
let cachedKey = '';

function settings() {
  const port = Number(cfg('SMTP_PORT')) || 465;
  return {
    host: String(cfg('SMTP_HOST') || '').trim(),
    port,
    user: String(cfg('SMTP_USER') || '').trim(),
    pass: String(cfg('SMTP_PASS') || ''),
    from: String(cfg('MAIL_FROM') || '').trim() || String(cfg('SMTP_USER') || '').trim(),
  };
}

export function isConfigured() {
  const s = settings();
  return Boolean(s.host && s.user && s.pass);
}

function transport() {
  const s = settings();
  if (!s.host || !s.user || !s.pass) throw new Error('SMTP is not configured');

  // The password is part of the identity of the transport but must not be part
  // of anything loggable, so the key holds its length rather than its value.
  const key = `${s.host}:${s.port}:${s.user}:${s.pass.length}:${s.from}`;
  if (cached && cachedKey === key) return cached;

  if (cached) { try { cached.close(); } catch { /* noop */ } }

  cached = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    // 465 is implicit TLS; 587 starts plaintext and upgrades with STARTTLS.
    // Getting this backwards does not warn, it just hangs until the timeout.
    secure: s.port === 465,
    auth: { user: s.user, pass: s.pass },
    pool: true,
    maxConnections: 2,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
  cachedKey = key;
  return cached;
}

/**
 * Send one message.
 *
 * Throws on failure. Callers that must not fail because of mail — a signup, a
 * password-reset REQUEST — are responsible for catching; see the note in
 * routes/auth.js about why the reset endpoint answers identically either way.
 */
export async function sendMail({ to, subject, html, text, replyTo }) {
  const s = settings();
  const info = await transport().sendMail({
    // `from` is always OUR mailbox. A forwarded message that puts the visitor's
    // address in From: fails SPF at the recipient and, repeated, is what gets a
    // domain's sending reputation destroyed. `replyTo` is the correct way to
    // make "reply" reach the person who wrote in.
    from: s.from,
    to,
    subject,
    text,
    html,
    ...(replyTo ? { replyTo } : null),
  });
  logger.info('mail sent', { messageId: info.messageId, accepted: info.accepted?.length ?? 0 });
  return info;
}

/** Admin-panel connectivity check. Verifies the credentials without sending. */
export async function verifyMail() {
  if (!isConfigured()) return { ok: false, reason: 'not_configured' };
  try {
    await transport().verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
