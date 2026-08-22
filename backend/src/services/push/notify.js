/**
 * Sending a notification: the one entry point the rest of the backend calls.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE: sendNotification() never throws.
 *
 * Its callers are an evaluation-completed hook and a balance-deduction hook —
 * both of them inside, or immediately after, a paid transaction. A rejected
 * promise from a courtesy push is how a user pays for an interview, gets
 * evaluated, and then sees a 500 because Google's token endpoint was slow. So
 * every path here is wrapped, every failure is logged and returns zeros, and
 * the business operation that triggered the push never learns that it failed.
 *
 * ONE MESSAGE PER LANGUAGE, NOT ONE PER USER
 *   Recipients are grouped by the language on the DEVICE row and sent one FCM
 *   message per group. Sending a single message with the Arabic copy is the
 *   obvious implementation and it is wrong in a bilingual product: half the
 *   install base gets a language it does not read. The English copy is
 *   optional, and an English device falls back to the Arabic one — an Arabic
 *   string in an English shade is a cosmetic annoyance, an empty title is a
 *   notification Android refuses to display at all.
 *
 * ONE AUDIT ROW PER CALL
 *   Written BEFORE the send, and updated with the outcome afterwards. Written
 *   first so its id can travel in the payload (the app matches the push to the
 *   inbox row with it) and so a send that hangs still leaves a trace of what
 *   was attempted. `sent_count = 0` on a row is a real, visible result — it is
 *   how an operator sees that a broadcast reached a table full of dead tokens.
 *
 * WHAT IS NOT HERE
 *   No retry, no queue, no scheduling. A broadcast is a sequential walk in
 *   batches (see fcm.sendToTokens) because this process also serves live
 *   interviews on one worker thread, and delivery latency of an announcement is
 *   nobody's SLA while the interview is.
 */

import { query } from '../../db/mysql.js';
import { logger } from '../../utils/logger.js';
import { flag } from '../appSettings.js';
import { cfg } from '../secrets/store.js';
import { buildMessage, isConfigured, sendToTokens } from './fcm.js';
import { AUDIENCES, retireToken, tokensForAudience } from './audience.js';

/**
 * The Android notification channel every message is posted to.
 *
 * Must match a channel the app has created. Android 8+ drops a notification
 * addressed to a channel that does not exist SILENTLY — no error, no log, no
 * delivery — so this constant is a contract with the mobile client, not a
 * default, and is exported so the client and the admin panel can name the same
 * thing.
 */
export const CHANNEL_ID = 'default';

/**
 * Screen names a tap may land on — the real keys of RootStackParamList in
 * mobile/src/navigation/RootNavigator.tsx.
 *
 * Validated rather than passed through, because `data.route` is the only thing
 * the app has to go on and a name that does not exist is a notification whose
 * tap does nothing at all. An unknown route is DROPPED, not rejected: the
 * message still goes out and opens the app on its default screen, which is a
 * far better outcome than refusing to send.
 *
 * Home / History / Stats / Profile are tabs nested under 'Main'; the client's
 * deep-link handler is what knows to route them through it.
 */
export const ROUTES = Object.freeze([
  'Home', 'History', 'Stats', 'Profile',
  'CategoryDetails', 'Interview', 'Feedback', 'SessionSummary',
  'Subscription', 'Ledger', 'MeetingSetup', 'Meeting', 'Settings',
]);

const ROUTE_SET = new Set(ROUTES);

/* ----------------------------- column widths ------------------------- *
 * notifications.title_* is VARCHAR(200) and body_* VARCHAR(500). MySQL is in
 * strict mode, so an over-long operator broadcast would error on INSERT and
 * lose the send entirely. Trimmed by CODE POINT rather than by `.length`, so a
 * pasted emoji cannot be cut in half into a lone surrogate.
 * --------------------------------------------------------------------- */
const TITLE_MAX = 200;
const BODY_MAX = 500;

function clamp(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max).join('');
}

/**
 * Whether a value means "on".
 *
 * PUSH_ENABLED needs its own parser because it resolves through two paths with
 * two types: from `provider_credentials` it is a real boolean (registry.coerce
 * knows it is type 'boolean'), but from the environment it is the RAW STRING
 * config/env.js stored — unlike every other flag there, it is declared as
 * `z.string()` rather than the `bool()` helper. So `cfg('PUSH_ENABLED')` can
 * return the string 'false', and the obvious `!== false` test would read that
 * as enabled and keep pushing after an operator had switched it off in .env.
 */
function truthy(v) {
  if (typeof v === 'boolean') return v;
  if (v === undefined || v === null || v === '') return true;
  return /^(true|1|yes|on)$/i.test(String(v).trim());
}

/** Can we send at all? False disables the whole subsystem, silently and safely. */
export function pushEnabled() {
  if (!isConfigured()) return false;
  return truthy(cfg('PUSH_ENABLED'));
}

const ZERO = Object.freeze({ id: null, total: 0, sent: 0, failed: 0, dead: 0 });

/**
 * Send one notification and record it.
 *
 * @param {object} p
 * @param {string} p.titleAr    required — the fallback copy for every language
 * @param {string} p.bodyAr     required
 * @param {string} [p.titleEn]
 * @param {string} [p.bodyEn]
 * @param {string} [p.route]    a RootStackParamList key; unknown values are dropped
 * @param {object} [p.data]     extra string payload (e.g. { sessionId })
 * @param {string} [p.audience] one of AUDIENCES
 * @param {string|number|bigint|null} [p.userId] required when audience is 'user'
 * @param {string} [p.kind]     'manual', or the event name for an automatic one
 * @param {string|number|bigint|null} [p.createdBy] admin id, for a broadcast
 * @returns {Promise<{id: string|null, total: number, sent: number, failed: number, dead: number}>}
 *   `id` is a STRING — notifications.id is BIGINT, and a BigInt reaching
 *   res.json() throws "Do not know how to serialize a BigInt".
 */
export async function sendNotification({
  titleAr, bodyAr, titleEn = null, bodyEn = null, route = null, data = {},
  audience = 'all', userId = null, kind = 'manual', createdBy = null,
} = {}) {
  let id = null;

  try {
    // Master switch: no send, and no row. A row for a notification that was
    // never attempted would make the history lie.
    if (!pushEnabled()) return { ...ZERO };

    const title = clamp(titleAr, TITLE_MAX);
    const body = clamp(bodyAr, BODY_MAX);
    if (!title || !body) {
      logger.warn('[push] refusing to send without Arabic title and body', { kind, audience });
      return { ...ZERO };
    }

    let segment = audience;
    if (!AUDIENCES.includes(segment)) {
      logger.warn('[push] unknown audience, sending to "all"', { audience, kind });
      segment = 'all';
    }
    if (segment === 'user' && (userId === null || userId === undefined)) {
      logger.warn('[push] audience "user" without a user id — nothing sent', { kind });
      return { ...ZERO };
    }

    let target = route ? String(route).trim() : null;
    if (target && !ROUTE_SET.has(target)) {
      logger.warn('[push] dropping an unknown deep-link route', { route: target, kind });
      target = null;
    }

    const recipients = await tokensForAudience(segment, { userId });

    const inserted = await query(
      'INSERT INTO `notifications`\n'
      + '  (`title_ar`, `body_ar`, `title_en`, `body_en`, `route`, `audience`, `user_id`, `kind`, `created_by`, `created_at`)\n'
      + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))',
      [
        title, body,
        clamp(titleEn, TITLE_MAX), clamp(bodyEn, BODY_MAX),
        target, segment,
        bigParam(userId), String(kind || 'manual').slice(0, 48), bigParam(createdBy),
      ],
    );
    // insertId is a number, or a string once it outgrows a double. Either way
    // it leaves this module as a string.
    id = inserted?.insertId === undefined || inserted?.insertId === null
      ? null
      : String(inserted.insertId);

    // An empty audience is a legitimate outcome, not an error — and it is
    // recorded, so "I sent it and nobody got it" is answerable afterwards.
    if (!recipients.length) return { id, total: 0, sent: 0, failed: 0, dead: 0 };

    /** @type {Map<'ar'|'en', string[]>} */
    const groups = new Map();
    for (const r of recipients) {
      const lang = r.language === 'en' ? 'en' : 'ar';
      const bucket = groups.get(lang);
      if (bucket) bucket.push(r.token);
      else groups.set(lang, [r.token]);
    }

    let total = 0;
    let sent = 0;
    let failed = 0;
    let dead = 0;

    for (const [language, tokens] of groups) {
      // Fall back to the Arabic copy rather than sending an empty title: FCM
      // accepts it and Android renders a blank row the user cannot read or act
      // on, which is worse than the wrong language.
      const copy = language === 'en'
        ? { title: clamp(titleEn, TITLE_MAX) || title, body: clamp(bodyEn, BODY_MAX) || body }
        : { title, body };

      const message = buildMessage({
        title: copy.title,
        body: copy.body,
        channelId: CHANNEL_ID,
        // `route` last so a caller's `data` can never shadow the deep link we
        // just validated. buildMessage() drops nulls and stringifies the rest.
        data: { ...data, kind, notificationId: id, language, route: target },
      });

      const out = await sendToTokens(tokens, message, retireToken);
      total += out.total;
      sent += out.sent;
      failed += out.failed;
      dead += out.dead;

      if (out.failed) {
        // The error CODES, not just a count: 'UNREGISTERED' is a normal fact of
        // life, 'AUTH_FAILED' on every token means the service account is
        // broken and no push has worked since it was rotated.
        logger.warn('[push] some sends failed', {
          id, kind, language, failed: out.failed, dead: out.dead, errors: out.errors,
        });
      }
    }

    // Best-effort: the messages are already delivered, so a failure to record
    // the tally must not turn into a thrown error that hides that fact.
    await query(
      'UPDATE `notifications` SET `sent_count` = ?, `failed_count` = ? WHERE `id` = ?',
      [sent, failed, id],
    ).catch((err) => logger.warn('[push] could not record the send tally', { id, message: err.message }));

    logger.info('[push] notification sent', { id, kind, audience: segment, total, sent, failed, dead });
    return { id, total, sent, failed, dead };
  } catch (err) {
    // The contract with every caller. A push that fails must never roll back a
    // paid interview, so this is the only exit an internal fault has.
    logger.error('[push] sendNotification failed', {
      kind, audience, id, message: err.message, stack: err.stack,
    });
    return { ...ZERO, id };
  }
}

/**
 * A BIGINT parameter for mysql2.
 *
 * Ids reach this module as a BigInt (Prisma), a string (mysql2) or a number,
 * and mysql2 cannot serialise a BigInt at all — it throws while formatting the
 * statement, inside the try/catch, which would turn every automatic
 * notification into a silent no-op that logs once per send.
 */
function bigParam(value) {
  if (value === undefined || value === null || value === '') return null;
  const s = typeof value === 'bigint' ? value.toString() : String(value).trim();
  if (!/^[0-9]{1,19}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : s;
}

/* ------------------------------------------------------------------ *
 * The automatic notifications.
 *
 * Each one is gated by its own app_settings kill switch, checked HERE rather
 * than at the call site, so an operator switching one off silences it
 * everywhere it is triggered from — including from a call site added later
 * that never knew the switch existed.
 *
 * The Arabic copy is deliberately short: Android shows roughly one line of
 * title and two of body before truncating, and a body that ends mid-sentence
 * with an ellipsis is a notification that has to be opened to be understood.
 * Digits are Western rather than Arabic-Indic, matching the balance the app
 * itself renders, and no line makes a claim about outcomes.
 * ------------------------------------------------------------------ */

/** Arabic minute agreement: 1 مفرد, 2 مثنى, 3-10 جمع قلة, 11+ تمييز مفرد. */
function arabicMinutes(m) {
  if (m === 1) return 'دقيقة واحدة';
  if (m === 2) return 'دقيقتان';
  if (m <= 10) return `${m} دقائق`;
  return `${m} دقيقة`;
}

/**
 * "You are about to run out." Fired by the balance-deduction hook when the
 * remaining balance crosses the low-water mark.
 *
 * Floors the minutes, never rounds: telling someone they have 3 minutes and
 * cutting them off at 2 is the same bug as lying, and it is the one they
 * complain about.
 */
export async function notifyLowBalance(userId, remainingSeconds) {
  if (!flag('push_low_balance_enabled')) return { ...ZERO };

  const secs = Math.max(0, Math.trunc(Number(remainingSeconds) || 0));
  const minutes = Math.floor(secs / 60);

  const bodyAr = minutes < 1
    ? 'لم يتبقَّ سوى أقل من دقيقة. يمكنك إضافة رصيد قبل مقابلتك القادمة.'
    : `تبقّى لك ${arabicMinutes(minutes)} تقريبًا. يمكنك إضافة رصيد قبل مقابلتك القادمة.`;

  const bodyEn = minutes < 1
    ? 'Less than a minute left. You can top up before your next interview.'
    : `About ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left. You can top up before your next interview.`;

  return sendNotification({
    titleAr: 'رصيدك من الدقائق أوشك على الانتهاء',
    bodyAr,
    titleEn: 'Your minutes are running low',
    bodyEn,
    route: 'Subscription',
    data: { remainingSeconds: secs },
    audience: 'user',
    userId,
    kind: 'low_balance',
  });
}

/**
 * "Your evaluation is ready." The one notification users are actually waiting
 * for — evaluation is asynchronous and can take a minute, which is long enough
 * to leave the app.
 *
 * `score` is optional: an evaluation that produced no numeric score still has
 * feedback worth opening, and a body reading "نتيجتك undefined" is worse than
 * one that does not mention a number at all.
 */
export async function notifyEvaluationReady(userId, { sessionId, score } = {}) {
  if (!flag('push_evaluation_ready_enabled')) return { ...ZERO };

  const n = Number(score);
  const hasScore = Number.isFinite(n);
  const value = hasScore ? Math.max(0, Math.min(100, Math.round(n))) : null;

  return sendNotification({
    titleAr: 'تقييم مقابلتك جاهز',
    bodyAr: hasScore
      ? `نتيجتك ${value} من 100. اطّلع على الملاحظات التفصيلية.`
      : 'اطّلع على نتيجتك وملاحظات التحسين في ملخص المقابلة.',
    titleEn: 'Your interview evaluation is ready',
    bodyEn: hasScore
      ? `You scored ${value} out of 100. Open the detailed feedback.`
      : 'Open your result and the improvement notes.',
    route: 'SessionSummary',
    // The screen takes { sessionId: string }; buildMessage stringifies every
    // data value, so a BigInt session id arrives as the string the app expects.
    data: { sessionId: sessionId === undefined || sessionId === null ? null : String(sessionId) },
    audience: 'user',
    userId,
    kind: 'evaluation_ready',
  });
}

/**
 * "Your free minutes are still there." For an account that was granted the
 * trial and never spent it.
 *
 * This module does not decide WHO is due one — the caller does, and the caller
 * is responsible for not sending it twice. Deliberately no urgency and no
 * deadline in the copy: the trial does not expire, and inventing a deadline to
 * drive a tap is the kind of claim this product does not make.
 */
export async function notifyTrialReminder(userId) {
  if (!flag('push_trial_reminder_enabled')) return { ...ZERO };

  return sendNotification({
    titleAr: 'دقائقك المجانية بانتظارك',
    bodyAr: 'لم تبدأ مقابلتك التجريبية بعد. ابدأ متى ما ناسبك الوقت.',
    titleEn: 'Your free minutes are waiting',
    bodyEn: 'You have not started your trial interview yet. Start whenever it suits you.',
    route: 'MeetingSetup',
    audience: 'user',
    userId,
    kind: 'trial_reminder',
  });
}
