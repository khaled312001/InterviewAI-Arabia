/**
 * Runtime reads of `app_settings`.
 *
 * The table existed and was written by GET/PUT /admin/settings, but nothing in
 * the backend ever read it: the admin could change "الحد اليومي المجاني", see
 * "تم الحفظ", and change nothing at all, because quota.js read
 * env.FREE_DAILY_QUESTION_LIMIT. This module is what makes a saved setting
 * take effect.
 *
 * Only keys listed in WIRED_KEYS are consumed. The admin UI mirrors that list
 * and marks everything else `not-wired` with a visible warning, so a setting
 * that does nothing says so instead of pretending.
 */

import { query } from '../db/mysql.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const TTL_MS = 60_000;

/**
 * An integer setting with an inclusive range and a hardcoded default.
 *
 * `min` is 0 for every metering constant that doubles as a kill switch —
 * `free_trial_seconds = 0` stops trial farming instantly, with no deploy — so
 * the parser must accept 0 rather than treating it as "unset" and falling back.
 */
const int = (def, min, max) => ({
  parse: (raw) => {
    const n = Number.parseInt(raw, 10);
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
  },
  fallback: () => def,
});

/**
 * A boolean setting — in practice always a kill switch, always defaulting ON.
 *
 * `Boolean("false") === true`, so the naive parser turns every switch an
 * operator has thrown back into "enabled" and the panel reports a change that
 * did nothing. Same trap config/env.js documents; same fix. An unrecognised
 * value returns null and therefore falls back to the default rather than
 * reading as off, because a typo must not silently switch a feature off.
 */
const bool = (def) => ({
  parse: (raw) => {
    const s = String(raw).trim().toLowerCase();
    if (/^(true|1|yes|on)$/.test(s)) return true;
    if (/^(false|0|no|off)$/.test(s)) return false;
    return null;
  },
  fallback: () => def,
});

/**
 * One or more OAuth client ids: `<digits>-<hash>.apps.googleusercontent.com`.
 *
 * A LIST, comma-separated, because Android needs one per signing certificate.
 * Google Cloud Console's Android client holds a single SHA-1, and a published
 * app has two fingerprints that matter — the upload key you sign with, and the
 * Play App Signing key Google re-signs with. That means two Android OAuth
 * clients, two client ids, and two possible `aud` values for the same human.
 * Accepting only one is why sign-in works in a locally-installed build and
 * fails for everyone who installs from the Store.
 *
 * Shape-checked rather than free text: a mistyped id fails at the `aud`
 * comparison inside a rejected login — a silent "Google sign-in failed" with
 * nothing on screen pointing at the setting that caused it. One bad entry
 * rejects the whole value rather than silently dropping it, so a typo is
 * visible in the admin panel instead of halving the accepted audiences.
 */
const CLIENT_ID_RE = /^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;

const clientId = () => ({
  parse: (raw) => {
    const parts = String(raw).split(',').map((v) => v.trim()).filter(Boolean);
    if (!parts.length) return null;
    return parts.every((v) => CLIENT_ID_RE.test(v)) ? parts.join(',') : null;
  },
  fallback: () => null,
});

/** key -> { parse, fallback } — the contract the admin registry mirrors. */
export const WIRED_KEYS = {
  free_daily_question_limit: {
    parse: (raw) => {
      const n = Number.parseInt(raw, 10);
      return Number.isInteger(n) && n > 0 && n <= 1000 ? n : null;
    },
    fallback: () => env.FREE_DAILY_QUESTION_LIMIT,
  },

  /* -------------------------- Google sign-in ---------------------------
   * PUBLIC client ids, not secrets — they ship inside the browser bundle and
   * the APK. They live here rather than in env so they can be pasted into the
   * admin panel the day the Google Cloud project is created, without a deploy.
   *
   * Google issues one per platform and the ID token's `aud` is whichever
   * client started the flow, so all three are accepted audiences. Leaving them
   * blank disables Google sign-in and hides the button — never "accept any
   * audience", which would let a token minted for any other Google app in.
   * ------------------------------------------------------------------- */
  google_client_id_web: clientId(),
  google_client_id_android: clientId(),
  google_client_id_ios: clientId(),

  /* ---------------------- minute metering (seconds) ---------------------
   * Every constant the meter reads lives here so pricing and generosity are
   * operator decisions, not deploys. All are SECONDS — the whole billing
   * system is integer seconds end to end; minutes exist only in the UI.
   * ------------------------------------------------------------------- */

  /** The free trial, and the kill switch. 0 disables the trial entirely. */
  free_trial_seconds: int(600, 0, 86_400),
  /** How often the client heartbeats a live meeting. Echoed to the client. */
  meeting_tick_seconds: int(15, 5, 120),
  /**
   * Any gap between heartbeats longer than this is billed at ZERO, not clamped.
   * If no heartbeat arrived then no /turn arrived either, so the interviewer
   * was not talking and we spent nothing — charging for it would be charging
   * for our own silence. Two missed heartbeats plus jitter.
   */
  meeting_max_gap_seconds: int(40, 20, 600),
  /** Live meeting with no tick for this long → swept, settled, abandoned. */
  meeting_abandon_seconds: int(120, 30, 3600),
  /** Size of the reservation a live meeting holds against the balance. */
  meeting_hold_seconds: int(300, 60, 3600),
  /** Refuse to open an interview with less than this: a call that dies in
   *  eight seconds is worse than one that never started. */
  meeting_min_start_seconds: int(60, 0, 3600),
  /** Floor per exchange. Closes the "stop ticking, call /turn every two
   *  minutes, every interval is a free >max-gap window" exploit. */
  meeting_min_turn_seconds: int(30, 0, 300),
  /** Below this the client shows the persistent "buy more" banner. */
  meeting_low_water_seconds: int(120, 0, 3600),
  /**
   * The ceiling on billable time between two consecutive turns of a client
   * that sends NO heartbeat (the legacy /turn path). The max-gap rule above
   * exists because a missing heartbeat is evidence of silence — but a client
   * that was never going to send one gives no such evidence, and zeroing every
   * inter-turn interval for it turns a thirty-minute interview into fifteen
   * turn floors. Capped rather than uncapped: the gap between two turns is
   * evidence the interview was in progress, a ten-minute pause is not.
   */
  meeting_turn_gap_seconds: int(120, 30, 900),
  /** Flat charge for a CV analysis — the most expensive single call. */
  cv_prepare_seconds: int(60, 0, 3600),
  /** Flat charge per evaluated practice answer. */
  practice_answer_seconds: int(30, 0, 3600),
  /** Subscription allowance granted per 30-day cycle. 300 minutes. */
  subscription_cycle_seconds: int(18_000, 0, 1_000_000),

  /* ------------------ automatic push kill switches -------------------
   * Seeded ON by migration 006. One per automatic notification rather than
   * one for all of them, because the failure they exist for is per-kind: the
   * low-balance nudge is the one that fires most often and is therefore the
   * one that gets called spam, and silencing it must not also silence "your
   * evaluation is ready" — which users are waiting for.
   *
   * These do NOT gate operator broadcasts, and they do not gate push as a
   * whole; PUSH_ENABLED (services/secrets) is the master switch.
   * ------------------------------------------------------------------- */
  push_low_balance_enabled: bool(true),
  push_evaluation_ready_enabled: bool(true),
  push_trial_reminder_enabled: bool(true),
};

/**
 * Keys the backend USED to read and no longer does.
 *
 * Listed rather than deleted so the admin panel can badge them "retired"
 * instead of rendering an editable number that changes nothing — which is
 * precisely the bug this module was written to eliminate.
 */
export const RETIRED_KEYS = {
  free_daily_question_limit: 'Replaced by the minute balance in migration 002.',
};

const cache = new Map();
let loadedAt = 0;
let inflight = null;

async function load() {
  const rows = await query('SELECT `key`, `value` FROM app_settings');
  cache.clear();
  for (const row of rows) cache.set(row.key, row.value);
  loadedAt = Date.now();
}

export async function reloadAppSettings() {
  if (!inflight) inflight = load().finally(() => { inflight = null; });
  return inflight;
}

export async function warmAppSettings() {
  try {
    await load();
  } catch (err) {
    logger.warn('[settings] warm-up failed, using env defaults', { message: err.message });
  }
}

function refreshIfStale() {
  if (Date.now() - loadedAt < TTL_MS || inflight) return;
  reloadAppSettings().catch((err) =>
    logger.warn('[settings] background refresh failed', { message: err.message }));
}

/**
 * Synchronous read with an env fallback. An unparseable stored value falls
 * back rather than throwing — a typo in the admin form must not take the
 * quota gate offline.
 */
export function setting(key) {
  const def = WIRED_KEYS[key];
  if (!def) return null;
  refreshIfStale();
  const raw = cache.get(key);
  if (raw === undefined || raw === null || raw === '') return def.fallback();
  const parsed = def.parse(raw);
  return parsed === null ? def.fallback() : parsed;
}

/**
 * The free tier's daily question allowance.
 *
 * RETIRED by migration 002 — nothing reads this any more. Kept so a rolled-back
 * backend and the admin registry both still resolve the key.
 */
export function freeDailyLimit() {
  return setting('free_daily_question_limit');
}

/** Integer-seconds accessor for the metering constants. */
export function seconds(key) {
  const v = setting(key);
  return Number.isInteger(v) ? v : 0;
}

/**
 * Boolean accessor for the kill switches. ON unless something says otherwise.
 *
 * Only an explicit stored `false` turns a feature off: an unknown key, an
 * unparseable value or a cache that has not warmed yet all read as enabled.
 * That is the right bias for a switch whose default is ON — a database hiccup
 * must not silently stop the "your evaluation is ready" notification, which is
 * a failure nobody would notice for weeks.
 */
export function flag(key) {
  return setting(key) !== false;
}
