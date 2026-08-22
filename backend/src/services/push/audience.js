/**
 * Device addresses: who a push can reach, and who it should reach.
 *
 * `device_tokens` is a table of ADDRESSES, not of users. That distinction is the
 * whole reason this module exists rather than a `prisma.deviceToken.findMany`
 * at each call site:
 *
 *   • A row can have no user. A fresh install registers its FCM token before
 *     anyone signs in, and it stays registered after sign-out (`user_id` is
 *     NULLed, never deleted) — so "how many devices can we reach" and "how many
 *     accounts can we reach" are different numbers, and a broadcast that joins
 *     `users` silently loses every signed-out install.
 *   • A row can be dead. FCM answers UNREGISTERED for an uninstalled app; we
 *     soft-retire the row rather than deleting it. EVERY read here filters on
 *     `disabled_at IS NULL`, because the one query that forgets to is the one
 *     that reports "sent to 40,000 devices" while delivering to 12,000.
 *   • The row, not the account, carries the language. The same person may read
 *     Arabic on their phone and English on the web, so notify.js groups by the
 *     `language` this table returns and never by `users.language`.
 *
 * Why raw SQL instead of Prisma
 *   `upsertToken` is `INSERT ... ON DUPLICATE KEY UPDATE` on a natural primary
 *   key with per-column COALESCE — Prisma's `upsert` cannot express "only
 *   overwrite the columns this request actually supplied", and a register call
 *   that omits `language` must not silently reset an English device to Arabic.
 *   The segment queries are read-only aggregates over two tables, which is the
 *   other thing this codebase routes through mysql2.
 *
 * BigInt discipline
 *   The mysql2 pool runs with supportBigNumbers + bigNumberStrings, so every
 *   BIGINT (`user_id`, and every COUNT/SUM) comes back as a STRING. Nothing in
 *   here ever hands a BigInt to a caller — a BigInt that reaches res.json()
 *   throws "Do not know how to serialize a BigInt", which is a 500 in
 *   production and the reason ids are stringified at every boundary.
 */

import { query } from '../../db/mysql.js';
import { logger } from '../../utils/logger.js';

/**
 * The segments a notification may target. Mirrored by the admin broadcast form
 * and validated there; an unknown value here is treated as 'all' rather than
 * throwing, because refusing to send is not obviously safer than sending wide.
 */
export const AUDIENCES = ['all', 'user', 'subscribers', 'trial', 'recent'];

/** How recently a device must have called us to count as 'recent'. */
const RECENT_DAYS = 30;

/**
 * Hard ceiling on the rows one call will pull into memory.
 *
 * Not a product rule — a safety valve. This process is a single Passenger
 * worker that also serves live interviews; materialising an unbounded token
 * list is how a broadcast turns into an OOM that drops calls in progress. A
 * real audience of this size needs a queue, not a bigger array, and hitting the
 * cap is logged loudly rather than silently truncating the denominator.
 */
const MAX_RECIPIENTS = 100_000;

/* -------------------------- column hygiene --------------------------- *
 * MySQL runs in strict mode: writing a string longer than the column errors
 * with "Data too long for column", which would turn a register call from a
 * device with an unusually long app version into a 500. Normalise and trim
 * here so the route never has to think about it.
 * --------------------------------------------------------------------- */

const TOKEN_MAX = 255;
const INSTALL_ID_MAX = 191;
const APP_VERSION_MAX = 32;

const trim = (v, max) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

/**
 * 'ar' or 'en', and nothing else.
 *
 * Clients send whatever their OS reports — 'en-US', 'ar-EG', 'ar_SA' — and the
 * column is only VARCHAR(8), so an untouched locale tag both overflows and
 * fails the `=== 'en'` comparison that picks the English copy. Everything that
 * is not recognisably English is Arabic: this is an Arabic-first product, and
 * the failure mode of the wrong default is an Arabic reader getting English.
 */
const languageOf = (v) => (String(v ?? '').trim().toLowerCase().startsWith('en') ? 'en' : 'ar');

const PLATFORMS = new Set(['android', 'ios', 'web']);

/** Returns null for anything unrecognised, so the column default applies. */
function platformOf(v) {
  const p = String(v ?? '').trim().toLowerCase();
  return PLATFORMS.has(p) ? p : null;
}

/**
 * A user id in a form mysql2 substitutes UNQUOTED.
 *
 * `user_id` is BIGINT. Passing the JavaScript string '42' produces
 * `user_id = '42'`, which MySQL answers correctly but only after an implicit
 * cast that makes `device_tokens_user_idx` unusable — a full scan on the one
 * query that runs for every automatic notification. Ids arrive here as a
 * BigInt (Prisma), a string (mysql2) or a number depending on the caller, so
 * they are normalised once, here.
 */
function userIdParam(userId) {
  if (userId === undefined || userId === null || userId === '') return null;
  const s = typeof userId === 'bigint' ? userId.toString() : String(userId).trim();
  if (!/^[0-9]{1,19}$/.test(s)) return null;
  const n = Number(s);
  // Beyond 2^53 a Number is no longer the same integer; fall back to the
  // string, which is slower but never wrong.
  return Number.isSafeInteger(n) ? n : s;
}

/** COUNT/SUM come back as strings (bigNumberStrings), and SUM over no rows is NULL. */
const count = (v) => Number(v ?? 0) || 0;

/* --------------------------- reading them --------------------------- */

const SELECT_LIVE = 'SELECT t.`token` AS token, t.`language` AS language FROM `device_tokens` t';

/**
 * Live tokens for one segment.
 *
 * @param {string} audience one of AUDIENCES
 * @param {{ userId?: string|number|bigint|null }} [opts]
 * @returns {Promise<Array<{ token: string, language: 'ar'|'en' }>>}
 *
 * Never throws for an unknown audience — it falls back to 'all' and says so.
 * The one case that returns an empty array on purpose is audience 'user' with
 * no user id: "send to nobody" is the only correct reading of that request,
 * and quietly broadcasting to everyone instead would be a catastrophe.
 */
export async function tokensForAudience(audience, { userId = null } = {}) {
  let key = audience;
  if (!AUDIENCES.includes(key)) {
    logger.warn('[push] unknown audience, falling back to "all"', { audience });
    key = 'all';
  }

  const uid = userIdParam(userId);
  let sql;
  let params;

  switch (key) {
    case 'user':
      if (uid === null) {
        logger.warn('[push] audience "user" requested without a user id — nobody targeted');
        return [];
      }
      sql = `${SELECT_LIVE} WHERE t.\`disabled_at\` IS NULL AND t.\`user_id\` = ? LIMIT ?`;
      params = [uid, MAX_RECIPIENTS];
      break;

    case 'subscribers':
      // A paid-up subscriber, decided the way billing/minutes.js:hasPremium
      // decides it — `plan` alone is NEVER trusted, because if the expiry sweep
      // stops running it stays 'premium' forever and this segment silently
      // becomes "everyone who ever subscribed".
      sql = `${SELECT_LIVE}
              JOIN \`users\` u ON u.\`id\` = t.\`user_id\`
             WHERE t.\`disabled_at\` IS NULL
               AND u.\`is_disabled\` = 0
               AND u.\`plan\` = 'premium'
               AND u.\`premium_until\` IS NOT NULL
               AND u.\`premium_until\` > NOW(3)
             LIMIT ?`;
      params = [MAX_RECIPIENTS];
      break;

    case 'trial':
      // Everyone who has been granted the free trial and is not a subscriber
      // today: the conversion segment. Deliberately NOT "has trial seconds
      // left" — someone who spent the trial and did not come back is exactly
      // who a win-back message is for, and gating on a remaining balance would
      // exclude them.
      sql = `${SELECT_LIVE}
              JOIN \`users\` u ON u.\`id\` = t.\`user_id\`
             WHERE t.\`disabled_at\` IS NULL
               AND u.\`is_disabled\` = 0
               AND u.\`trial_granted_at\` IS NOT NULL
               AND NOT (u.\`plan\` = 'premium'
                        AND u.\`premium_until\` IS NOT NULL
                        AND u.\`premium_until\` > NOW(3))
             LIMIT ?`;
      params = [MAX_RECIPIENTS];
      break;

    case 'recent':
      // Devices that have talked to us lately. A DEVICE filter, not a user one,
      // so it keeps signed-out installs — which is the point of having it
      // alongside 'all': it is 'all' minus the handsets that stopped answering
      // long before FCM got round to admitting the token is dead.
      sql = `${SELECT_LIVE}
             WHERE t.\`disabled_at\` IS NULL
               AND t.\`last_seen_at\` >= (NOW(3) - INTERVAL ? DAY)
             LIMIT ?`;
      params = [RECENT_DAYS, MAX_RECIPIENTS];
      break;

    case 'all':
    default:
      sql = `${SELECT_LIVE} WHERE t.\`disabled_at\` IS NULL LIMIT ?`;
      params = [MAX_RECIPIENTS];
      break;
  }

  const rows = await query(sql, params);

  if (rows.length >= MAX_RECIPIENTS) {
    logger.warn('[push] audience hit the recipient ceiling — the send is incomplete', {
      audience: key, ceiling: MAX_RECIPIENTS,
    });
  }

  // Normalised on read as well as on write: rows predating the write-side
  // normalisation, or written straight into MySQL, still have to route to a
  // language group that exists.
  return rows.map((r) => ({ token: r.token, language: languageOf(r.language) }));
}

/* --------------------------- writing them --------------------------- */

/**
 * Register or refresh one device.
 *
 * `token` is the PRIMARY KEY, which is the whole design of the table: the same
 * handset signing in again is an UPSERT, so there is no way to end up with two
 * live rows for one device and start delivering everything twice.
 *
 * Three rules the ON DUPLICATE clause encodes, each of them a bug that has
 * happened to somebody:
 *
 *   1. A NULL `userId` NEVER clears an existing one. Registration is
 *      auth-OPTIONAL, so a signed-in app whose access token has just expired
 *      re-registers anonymously — and a plain assignment would sign that device
 *      out of every future personal notification. Sign-out has its own verb:
 *      detachToken().
 *   2. An omitted field never overwrites a known one, hence COALESCE per
 *      column. A minimal `{ token }` heartbeat must not reset the language.
 *   3. `disabled_at` is cleared. If we ever retire a token on a transient FCM
 *      error, the next launch of a perfectly healthy app silently un-retires
 *      it; without this, that device is deaf forever.
 *
 * What the clause deliberately does NOT do is refuse a token that already
 * belongs to somebody else, and that is a judgement rather than an oversight.
 * The same handset signing in as a different person is how a device is handed
 * over, and a sign-out whose detachToken() call never reached us — the client
 * swallows that failure when it is offline — leaves the row still claimed by
 * the departing account. Refusing the move would leave that handset ringing
 * for the previous owner forever, which is the outcome all of this exists to
 * prevent.
 *
 * So the hand-over stands, but it is never SILENT. Anyone holding somebody
 * else's FCM token can POST it here under their own bearer and repoint that
 * handset at their own notifications — tokensForAudience('user') then resolves
 * `WHERE user_id = ?` onto the wrong phone, evaluation scores and all — and
 * the warning below is the only trace such a takeover leaves behind.
 *
 * @returns {Promise<boolean>} false when the token is unusable (empty, or
 *   longer than the column). Deliberately not a throw: the register route
 *   answers `{ ok: true }` either way — a client cannot fix its own FCM token
 *   and a 500 there would just make the app retry a doomed call in a loop.
 */
export async function upsertToken({ token, userId = null, platform = null, language = null, installId = null, appVersion = null } = {}) {
  const value = token === undefined || token === null ? '' : String(token).trim();
  if (!value || value.length > TOKEN_MAX) {
    logger.warn('[push] refusing to store an unusable device token', { length: value.length });
    return false;
  }

  const uid = userIdParam(userId);
  const plat = platformOf(platform);
  const lang = language === undefined || language === null || language === '' ? null : languageOf(language);
  const install = trim(installId, INSTALL_ID_MAX);
  const version = trim(appVersion, APP_VERSION_MAX);

  // Who holds the row right now, so a change of hands leaves a record. One
  // lookup on the PRIMARY KEY, and only on the authenticated path: an
  // anonymous register can never move a row (rule 1), so there is nothing to
  // report there. The token itself is never logged — an account id and an
  // install id are enough to follow the trail, and a token is a credential.
  if (uid !== null) {
    const rows = await query(
      'SELECT `user_id` AS userId FROM `device_tokens` WHERE `token` = ?',
      [value],
    );
    const owner = rows[0]?.userId ?? null; // a string, never a BigInt — see the header
    if (owner !== null && String(owner) !== String(uid)) {
      logger.warn('[push] device token changed hands — it was registered to another account', {
        previousUserId: String(owner), userId: String(uid), installId: install,
      });
    }
  }

  // The optional columns are passed TWICE — once for the INSERT branch, where a
  // NULL has to become the column default because `platform` and `language` are
  // NOT NULL, and once for the UPDATE branch, where a NULL has to mean "leave
  // it alone". `VALUES(col)` cannot express the second: by then the INSERT
  // branch has already substituted the default, so COALESCE(VALUES(platform), …)
  // would read 'android' rather than "unspecified".
  await query(
    'INSERT INTO `device_tokens`\n'
    + '  (`token`, `user_id`, `platform`, `language`, `install_id`, `app_version`, `last_seen_at`, `created_at`)\n'
    + "VALUES (?, ?, COALESCE(?, 'android'), COALESCE(?, 'ar'), ?, ?, NOW(3), NOW(3))\n"
    + 'ON DUPLICATE KEY UPDATE\n'
    + '  `user_id`     = COALESCE(VALUES(`user_id`), `user_id`),\n'
    + '  `platform`    = COALESCE(?, `platform`),\n'
    + '  `language`    = COALESCE(?, `language`),\n'
    + '  `install_id`  = COALESCE(?, `install_id`),\n'
    + '  `app_version` = COALESCE(?, `app_version`),\n'
    + '  `disabled_at` = NULL,\n'
    + '  `last_seen_at` = NOW(3)',
    [value, uid, plat, lang, install, version, plat, lang, install, version],
  );

  return true;
}

/**
 * Sign-out: the device stays reachable, it just is not anybody's any more.
 *
 * Deleting the row instead is the classic mistake — it drops the address, so
 * "notify me when I log back in" and every announcement to signed-out installs
 * quietly stop working for that handset until FCM happens to rotate the token.
 *
 * Scoped to the caller's own user id, ALWAYS — there is no anonymous form of
 * this verb, and the obvious way of writing "scope it only when a caller is
 * known" is why. `AND (? IS NULL OR user_id = ?)` binds NULL for a caller with
 * no id, `NULL IS NULL` is TRUE, and the whole scope evaporates: since the
 * route in front of this uses optionalUser, simply OMITTING the Authorization
 * header turned a leaked token into an unauthenticated write that unlinks any
 * handset from its account and silences every personal notification to it
 * until the app happens to register again.
 *
 * Refusing an unscoped call costs nothing, because the client never makes one:
 * sign-out sends this BEFORE clearing its credentials (mobile/src/push/
 * registration.ts) precisely because "a request sent after the credentials are
 * gone detaches nothing". This is that promise, kept on the server side.
 *
 * A row that is already detached, or that belongs to somebody else, matches
 * nothing and reports false, which is the correct outcome rather than an error.
 *
 * @returns {Promise<boolean>} whether a row actually changed.
 */
export async function detachToken(token, userId = null) {
  const value = token === undefined || token === null ? '' : String(token).trim();
  if (!value || value.length > TOKEN_MAX) return false;

  const uid = userIdParam(userId);
  if (uid === null) {
    logger.warn('[push] detach requested without a user id — no device was unlinked');
    return false;
  }

  const res = await query(
    'UPDATE `device_tokens` SET `user_id` = NULL, `last_seen_at` = NOW(3)\n'
    + ' WHERE `token` = ? AND `user_id` = ?',
    [value, uid],
  );
  return Number(res?.affectedRows || 0) > 0;
}

/**
 * Soft-retire a token FCM has declared dead.
 *
 * Called from the sendToTokens() dead-token callback, so it runs once per dead
 * address inside a broadcast and must stay cheap and must not throw — fcm.js
 * swallows a rejection, but a throw here would still cost a rejected promise
 * per dead token on a run where thousands of them are dead at once.
 *
 * `AND disabled_at IS NULL` keeps the retirement TIMESTAMP honest: it records
 * when the device first went dark, not the last time a broadcast rediscovered
 * it, which is what makes "how many devices went stale this week" answerable.
 */
export async function retireToken(token) {
  const value = token === undefined || token === null ? '' : String(token).trim();
  if (!value || value.length > TOKEN_MAX) return false;

  try {
    const res = await query(
      'UPDATE `device_tokens` SET `disabled_at` = NOW(3) WHERE `token` = ? AND `disabled_at` IS NULL',
      [value],
    );
    return Number(res?.affectedRows || 0) > 0;
  } catch (err) {
    logger.warn('[push] failed to retire a dead token', { message: err.message });
    return false;
  }
}

/* ------------------------------ counting ----------------------------- */

/**
 * The numbers the admin push panel leads with.
 *
 * `total` and `live` are reported separately on purpose. They are the same
 * number on a healthy install base and diverge as devices are uninstalled, so
 * the gap between them is the single most useful signal on that page — and a
 * panel that showed only `total` would let an operator believe a broadcast
 * reached an audience that has not existed for months.
 *
 * @returns {Promise<{total:number, live:number, byPlatform:Record<string,number>, signedIn:number, anonymous:number}>}
 */
export async function deviceCounts() {
  const [totals, platforms] = await Promise.all([
    query(
      'SELECT COUNT(*) AS total,\n'
      + '       SUM(`disabled_at` IS NULL) AS live,\n'
      + '       SUM(`disabled_at` IS NULL AND `user_id` IS NOT NULL) AS signedIn,\n'
      + '       SUM(`disabled_at` IS NULL AND `user_id` IS NULL) AS anonymous\n'
      + '  FROM `device_tokens`',
    ),
    query(
      'SELECT `platform` AS platform, COUNT(*) AS n\n'
      + '  FROM `device_tokens`\n'
      + ' WHERE `disabled_at` IS NULL\n'
      + ' GROUP BY `platform`',
    ),
  ]);

  const row = totals[0] || {};
  return {
    total: count(row.total),
    live: count(row.live),
    // Live devices only — a byPlatform that counted retired rows would not add
    // up to `live`, and a breakdown whose parts do not sum to the whole is read
    // as a bug in the panel rather than a fact about the data.
    byPlatform: Object.fromEntries(platforms.map((p) => [p.platform || 'unknown', count(p.n)])),
    signedIn: count(row.signedIn),
    anonymous: count(row.anonymous),
  };
}
