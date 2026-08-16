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

/** key -> { parse, envFallback } — the contract the admin registry mirrors. */
export const WIRED_KEYS = {
  free_daily_question_limit: {
    parse: (raw) => {
      const n = Number.parseInt(raw, 10);
      return Number.isInteger(n) && n > 0 && n <= 1000 ? n : null;
    },
    fallback: () => env.FREE_DAILY_QUESTION_LIMIT,
  },
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

/** The free tier's daily question allowance. */
export function freeDailyLimit() {
  return setting('free_daily_question_limit');
}
