/**
 * Saved-search alerts: once a day (or a week) per saved search, the jobs that
 * entered the index since the last alert, by email.
 *
 * Each search is claimed with a conditional UPDATE of `last_sent_at` before
 * anything is sent, so the in-process scheduler and the external cron pinger
 * can both run this without a person receiving the same digest twice. The
 * claim also advances when nothing new matched, so a quiet search does not
 * pile up into one huge digest later.
 */

import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { query } from '../../db/mysql.js';
import { searchJobs } from '../jobs/store.js';
import { searchSchema, toFilters } from '../jobs/filters.js';
import { sendMail, isConfigured as mailConfigured } from '../mail/mailer.js';
import { jobAlertEmail } from '../mail/templates.js';
import { matchJob } from './match.js';
import { loadProfile, matchProfileOf, profileIsUsable } from './profile.js';

const SITE = (env.APP_URL || 'https://interprova.com').replace(/\/$/, '');
const HOUR = 3600_000;
const DUE = { daily: 20 * HOUR, weekly: 6.5 * 24 * HOUR };

function parseJson(v) {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return {}; }
}

export function unsubscribeToken(searchId, userId) {
  return jwt.sign({ type: 'alert-off', s: String(searchId), sub: String(userId) }, env.JWT_SECRET, { expiresIn: '60d' });
}

function searchPageUrl(q) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) params.set(k, v);
  return `${SITE}/jobs${params.toString() ? `?${params}` : ''}`;
}

/**
 * @param {{ limit?: number, budgetMs?: number }} [opts]
 * @returns {Promise<{ searchesChecked:number, alertsSent:number, failed:number }>}
 */
export async function runJobAlerts({ limit = 200, budgetMs = 100_000 } = {}) {
  const out = { searchesChecked: 0, alertsSent: 0, failed: 0 };
  if (!mailConfigured()) return out;
  const now = new Date();
  const started = Date.now();

  const due = await query(
    `SELECT s.id, s.user_id, s.name, s.query, s.frequency, s.last_sent_at, u.email, u.language
       FROM saved_searches s JOIN users u ON u.id = s.user_id
      WHERE (s.frequency = 'daily' AND (s.last_sent_at IS NULL OR s.last_sent_at < ?))
         OR (s.frequency = 'weekly' AND (s.last_sent_at IS NULL OR s.last_sent_at < ?))
      ORDER BY s.last_sent_at ASC
      LIMIT ?`,
    [new Date(now - DUE.daily), new Date(now - DUE.weekly), limit],
  );

  const profiles = new Map();
  for (const s of due) {
    if (Date.now() - started > budgetMs) break;
    // Claim first; a concurrent runner that claimed it already gets 0 rows.
    const claim = await query(
      'UPDATE saved_searches SET last_sent_at = ? WHERE id = ? AND (last_sent_at <=> ?)',
      [now, String(s.id), s.last_sent_at],
    );
    if (!claim.affectedRows) continue;
    out.searchesChecked += 1;

    try {
      const saved = parseJson(s.query);
      const parsed = searchSchema.safeParse({ ...saved, sort: 'date', page: 1, pageSize: 10 });
      if (!parsed.success) continue;
      const since = s.last_sent_at || new Date(now - DUE[s.frequency]);
      const result = await searchJobs({ ...toFilters(parsed.data), sort: 'date', seenSince: since });
      if (!result.total) continue;

      let jobs = result.jobs;
      if (!profiles.has(s.user_id)) profiles.set(s.user_id, await loadProfile(s.user_id).catch(() => null));
      const profile = profiles.get(s.user_id);
      if (profileIsUsable(profile)) {
        const mp = matchProfileOf(profile);
        jobs = jobs.map((j) => ({ ...j, match: { score: matchJob(mp, j).score } }));
      }

      const mail = jobAlertEmail({
        language: s.language === 'en' ? 'en' : 'ar',
        searchName: s.name,
        jobs,
        total: result.total,
        searchUrl: searchPageUrl(saved),
        unsubscribeUrl: `${SITE}/api/career/alerts/off/${unsubscribeToken(s.id, s.user_id)}`,
      });
      await sendMail({ to: s.email, ...mail });
      out.alertsSent += 1;
    } catch (err) {
      out.failed += 1;
      logger.warn('job alert failed', { searchId: String(s.id), message: err.message });
    }
  }
  return out;
}
