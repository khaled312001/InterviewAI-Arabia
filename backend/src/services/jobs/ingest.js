/**
 * The ingester: which feed runs now, and what a run does.
 *
 * Called every ten minutes by the in-process scheduler (services/cron.js) and
 * by /api/cron/jobs-ingest for an external pinger (hPanel cron, every 15 min). Each call runs the most
 * overdue feeds, one at a time, inside a time budget — the host counts threads
 * and CPU against the whole account, so a burst of parallel fetches and JSON
 * parses would starve the live interview running in the same process.
 */

import { cfg } from '../secrets/store.js';
import { logger } from '../../utils/logger.js';
import { query, pool } from '../../db/mysql.js';
import {
  sourceRegistry, normalizeAll, jsearch, jsearchConfigured, adzuna, adzunaConfigured, ADZUNA_COUNTRIES,
  himalayasSearch, jobicySearch, remoteokSearch, jooble, joobleConfigured,
} from './sources.js';
import { touchKnown, upsertJobs, closeMissing, logRun, lastRuns, prune } from './store.js';
import { setting } from '../appSettings.js';

const MAX_AGE_MS = 60 * 86400_000;
let running = false;

/**
 * Run `fn` only if no other process holds the named lock; otherwise skip.
 *
 * The host starts more than one copy of the app, and each copy has its own
 * scheduler, so `running` alone let two copies fetch the same feed in the same
 * minute. A MySQL named lock is shared by every copy (and by the external
 * pinger). It lives on one connection, so that connection is held for the run
 * and the lock goes away with it if the process dies.
 */
async function withDbLock(name, fn) {
  let conn;
  try {
    conn = await pool.getConnection();
  } catch (err) {
    logger.warn('job lock: no connection', { message: err.message });
    return null;
  }
  try {
    const [[row]] = await conn.query('SELECT GET_LOCK(?, 0) AS got', [name]);
    if (Number(row?.got) !== 1) return null;
    try {
      return await fn();
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [name]).catch(() => {});
    }
  } finally {
    conn.release();
  }
}

/** Fetch one feed and fold it into the index. Never throws. */
export async function runSource(src) {
  // Whole seconds, because DATETIME stores whole seconds (MySQL rounds the
  // fraction). With milliseconds here, a job stamped `last_seen_at = startedAt`
  // can read back as EARLIER than startedAt, and closeMissing() would close
  // every job the run had just seen.
  const startedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  const entry = { source: src.id, startedAt, finishedAt: null, fetched: 0, inserted: 0, updated: 0, ok: false, error: null };
  try {
    const items = await src.run();
    entry.fetched = items.length;
    const result = await foldIn(items, startedAt);
    entry.inserted = result.inserted;
    entry.updated = result.updated;
    const [base, board] = src.id.split(':');
    if (board) await closeMissing({ source: base, board, runStartedAt: startedAt });
    entry.ok = true;
  } catch (err) {
    entry.error = err.message;
    logger.warn('job source failed', { source: src.id, message: err.message });
  }
  entry.finishedAt = new Date();
  await logRun(entry);
  return entry;
}

/** At most this many detail pages are fetched per feed run. */
const HYDRATE_CAP = 120;

/**
 * Some feeds list postings without their text (SmartRecruiters) and carry a
 * `hydrate()` that fetches it. Only NEW postings get there — known ones were
 * filtered out before — and at most HYDRATE_CAP per run, a few at a time, so a
 * 900-job board fills in over a few runs instead of 900 requests in one.
 * Postings past the cap are left out of this run and stay "new" for the next.
 */
async function hydrate(items, now) {
  const need = items.filter((i) => typeof i.hydrate === 'function');
  if (!need.length) return items;
  const recent = need.filter((i) => !i.postedAt || now - new Date(i.postedAt) < MAX_AGE_MS).slice(0, HYDRATE_CAP);
  const keep = new Set();
  for (let k = 0; k < recent.length; k += 4) {
    await Promise.all(recent.slice(k, k + 4).map(async (it) => {
      try {
        Object.assign(it, await it.hydrate());
        keep.add(it);
      } catch (err) {
        logger.warn('job detail fetch failed', { source: it.source, message: err.message });
      }
    }));
  }
  return items.filter((i) => typeof i.hydrate !== 'function' || keep.has(i));
}

/** Known jobs: bump. New jobs: normalise and insert. Old postings: ignore. */
async function foldIn(items, now = new Date()) {
  const bySource = new Map();
  for (const it of items) {
    if (!it?.source || !it.externalId) continue;
    if (!bySource.has(it.source)) bySource.set(it.source, []);
    bySource.get(it.source).push(it);
  }
  let inserted = 0;
  let updated = 0;
  for (const [source, list] of bySource) {
    const known = await touchKnown(source, list.map((i) => String(i.externalId).slice(0, 191)), now);
    updated += known.size;
    let fresh = list.filter((i) => !known.has(String(i.externalId).slice(0, 191)));
    fresh = await hydrate(fresh, now);
    const rows = normalizeAll(fresh).filter((r) => now - r.postedAt < MAX_AGE_MS);
    if (rows.length) {
      const res = await upsertJobs(rows, now);
      inserted += res.inserted;
    }
  }
  return { inserted, updated };
}

/**
 * Run the feeds that are due, most overdue first.
 * @returns {Promise<object[]>} one log entry per feed that ran
 */
export async function runDueSources({ maxSources = 6, budgetMs = 120_000, force = false } = {}) {
  if (!force && !cfg('JOBS_INGEST_ENABLED')) return [];
  if (running) return [];
  running = true;
  const deadline = Date.now() + budgetMs;
  const done = [];
  try {
    await withDbLock('interprova_jobs_ingest', () => runDue({ maxSources, deadline, force, done }));
  } finally {
    running = false;
  }
  if (done.length) {
    const inserted = done.reduce((n, d) => n + d.inserted, 0);
    logger.info('job ingest', { sources: done.length, inserted, failed: done.filter((d) => !d.ok).length });
  }
  return done;
}

/** Run the overdue feeds, most overdue first, into `done`. Caller holds the lock. */
async function runDue({ maxSources, deadline, force, done }) {
  const runs = await lastRuns();
  const now = Date.now();
  const due = sourceRegistry()
    .map((s) => {
      const last = runs.get(s.id)?.lastStarted;
      const lastOk = runs.get(s.id)?.lastOk;
      // A feed that keeps failing backs off to four times its interval, so a
      // dead board costs one request every couple of days, not every slot.
      const failing = last && (!lastOk || new Date(lastOk) < new Date(last));
      const gap = failing ? s.every * 4 : s.every;
      const overdue = last ? now - new Date(last).getTime() - gap : Number.MAX_SAFE_INTEGER;
      return { s, overdue };
    })
    .filter((d) => force || d.overdue >= 0)
    .sort((a, b) => b.overdue - a.overdue);

  for (const { s } of due) {
    if (done.length >= maxSources || Date.now() > deadline) break;
    done.push(await runSource(s));
  }
}

/** Nightly clean-up; one copy of the app does it, the others skip. */
export async function pruneJobs() {
  return (await withDbLock('interprova_jobs_prune', () => prune())) ?? { skipped: true };
}

/* ------------------------------------------------------- live search */

const liveCache = new Map();
/**
 * How long one live answer is reused for the same query. Short, so a search
 * shows what is open now; long enough that a thousand people typing the same
 * thing in the same minutes cost the upstream feeds one request, not a
 * thousand (they are free and rate-limited, and we want to stay welcome).
 */
const LIVE_TTL = 3 * 60_000;
const LIVE_TIMEOUT = 6500;

/** The live sources a search can ask, in display order. Keyed ones only when configured. */
function liveSources({ query, country, remoteOnly, page }) {
  const cc = country ? country.toLowerCase() : null;
  const list = [
    { id: 'himalayas', label: 'Himalayas', run: () => himalayasSearch({ query, country, page, timeout: LIVE_TIMEOUT }) },
  ];
  if (page === 1) {
    list.push({ id: 'jobicy', label: 'Jobicy', run: () => jobicySearch({ query, timeout: LIVE_TIMEOUT }) });
    list.push({ id: 'remoteok', label: 'Remote OK', run: () => remoteokSearch({ query, timeout: LIVE_TIMEOUT }) });
  }
  if (jsearchConfigured()) {
    list.push({ id: 'jsearch', label: 'Google for Jobs', run: () => jsearch({ query, country, page, remoteOnly }) });
  }
  if (adzunaConfigured() && cc && ADZUNA_COUNTRIES.includes(cc)) {
    list.push({ id: 'adzuna', label: 'Adzuna', run: () => adzuna({ country: cc, query, page, perPage: 50 }) });
  }
  // The API key is for jooble.org, which lists US jobs only (a search for
  // "accountant" in Dubai returns nothing; the country sites refuse the key),
  // so it is only asked when the search is not tied to another country.
  if (joobleConfigured() && (!cc || cc === 'us') && setting('jooble_daily_calls') > 0 && Date.now() > joobleRestUntil) {
    list.push({ id: 'jooble', label: 'Jooble', run: () => joobleBudgeted({ query, location: '', page, timeout: LIVE_TIMEOUT }) });
  }
  return list;
}

/** After Jooble refuses the key (allowance spent, or revoked), leave it alone for a while. */
let joobleRestUntil = 0;

/**
 * Jooble's free key is a fixed allowance (500 requests), so every live call
 * first takes one unit from today's shared counter (migration 013) and is
 * skipped once the daily cap is reached. Repeat searches never get here: the
 * live cache answers them.
 */
async function joobleBudgeted(args) {
  const res = await query(
    `INSERT INTO api_daily_usage (provider, day, calls) VALUES ('jooble', UTC_DATE(), LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE calls = LAST_INSERT_ID(calls + 1)`,
  );
  if (Number(res.insertId) > setting('jooble_daily_calls')) return [];
  try {
    return await jooble(args);
  } catch (err) {
    if (/^(401|403|429) /.test(err.message)) joobleRestUntil = Date.now() + 6 * 3600_000;
    throw err;
  }
}

/** Index ids of the raw items just folded in, so the search can put them first. */
async function idsFor(items) {
  const bySource = new Map();
  for (const it of items) {
    if (!it?.source || !it.externalId) continue;
    if (!bySource.has(it.source)) bySource.set(it.source, new Set());
    bySource.get(it.source).add(String(it.externalId).slice(0, 191));
  }
  const ids = [];
  for (const [source, set] of bySource) {
    const list = [...set];
    for (let i = 0; i < list.length; i += 300) {
      const part = list.slice(i, i + 300);
      const rows = await query(
        `SELECT id FROM jobs WHERE is_active = 1 AND source = ? AND external_id IN (${part.map(() => '?').join(',')})`,
        [source, ...part],
      );
      ids.push(...rows.map((r) => String(r.id)));
    }
  }
  return ids;
}

/**
 * Search the live feeds for this query now, fold what they return into the
 * index (so details, matching, tailoring and "save" work on it like any other
 * job), and report which jobs came back live.
 *
 * Every feed is asked in parallel with its own timeout; one slow or failing
 * feed never holds back the others or the search.
 *
 * @returns {Promise<{ ids: string[], sources: {id:string,label:string,count:number,ok:boolean}[], at: string, cached: boolean }>}
 */
export async function liveSearch({ q, country, remoteOnly = false, page = 1 }) {
  const query = String(q || '').trim().slice(0, 100);
  if (!query) return { ids: [], sources: [], at: new Date().toISOString(), cached: false };
  const key = `${query.toLowerCase()}|${country || ''}|${remoteOnly ? 1 : 0}|${page}`;
  const hit = liveCache.get(key);
  if (hit && hit.t > Date.now() - LIVE_TTL) return { ...(await hit.p), cached: true };

  const p = (async () => {
    const srcs = liveSources({ query, country, remoteOnly, page });
    const settled = await Promise.allSettled(srcs.map((s) => s.run()));
    const items = [];
    const sources = srcs.map((s, i) => {
      const r = settled[i];
      if (r.status === 'rejected') {
        logger.warn('live job search failed', { source: s.id, message: r.reason?.message });
        return { id: s.id, label: s.label, count: 0, ok: false };
      }
      items.push(...r.value);
      return { id: s.id, label: s.label, count: r.value.length, ok: true };
    });
    if (items.length) await foldIn(items);
    const ids = items.length ? await idsFor(items) : [];
    return { ids, sources, at: new Date().toISOString() };
  })();
  liveCache.set(key, { t: Date.now(), p });
  if (liveCache.size > 3000) {
    for (const [k, v] of liveCache) if (v.t < Date.now() - LIVE_TTL) liveCache.delete(k);
  }
  try {
    return { ...(await p), cached: false };
  } catch (err) {
    liveCache.delete(key);
    throw err;
  }
}

export function liveSearchAvailable() {
  return true;
}
