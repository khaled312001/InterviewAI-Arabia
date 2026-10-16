/**
 * The job index: writes from the ingester, reads for search.
 *
 * mysql2 only (see migration 010 for why not Prisma). Every statement is
 * parameterised; the few identifiers that are interpolated come from fixed
 * allow-lists in this file, never from a request.
 */

import { query, queryOne } from '../../db/mysql.js';
import { logger } from '../../utils/logger.js';
import { SOURCE_NAMES } from './sources.js';
import { skillLabel } from './skills.js';

const DAY = 86400_000;

/** Company boards list every open job on every fetch; a job missing from one is closed. */
const SNAPSHOT_SOURCES = new Set(['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'recruitee']);

/** When two feeds carry the same job, the employer's own board wins. */
const SOURCE_RANK = {
  greenhouse: 0, lever: 0, ashby: 0, smartrecruiters: 0, workable: 0, recruitee: 0, adzuna: 2, jsearch: 2, jooble: 2,
};
const rank = (s) => SOURCE_RANK[s] ?? 3;

const COLUMNS = [
  'source', 'source_board', 'external_id', 'dedup_hash', 'title', 'company', 'company_logo', 'url', 'apply_url',
  'location', 'country', 'city', 'workplace', 'employment_type', 'seniority', 'category', 'salary_min', 'salary_max',
  'salary_currency', 'salary_period', 'description', 'skills', 'language', 'posted_at', 'first_seen_at', 'last_seen_at',
  'is_active',
];

function rowValues(j, now, active) {
  return [
    j.source, j.sourceBoard, j.externalId, j.dedupHash, j.title, j.company, j.companyLogo, j.url, j.applyUrl,
    j.location, j.country, j.city, j.workplace, j.employmentType, j.seniority, j.category, j.salaryMin, j.salaryMax,
    j.salaryCurrency, j.salaryPeriod, j.description, j.skills, j.language, j.postedAt, now, now, active ? 1 : 0,
  ];
}

/**
 * Insert new jobs and refresh the ones already known.
 *
 * Known jobs only get `last_seen_at` bumped: re-normalising thousands of
 * unchanged descriptions every hour would be most of the ingester's CPU on a
 * shared host, for no change in what anyone sees.
 *
 * @param {object[]} jobs normalised rows (normalize.js)
 * @returns {Promise<{inserted:number, updated:number}>}
 */
export async function upsertJobs(jobs, now = new Date()) {
  let inserted = 0;
  let updated = 0;
  // Same feed can list one job twice; keep the first.
  const seen = new Set();
  const unique = jobs.filter((j) => {
    const k = `${j.source}|${j.externalId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  for (let i = 0; i < unique.length; i += 200) {
    const batch = unique.slice(i, i + 200);
    // One source per batch is the normal case; group defensively anyway.
    const bySource = new Map();
    for (const j of batch) {
      if (!bySource.has(j.source)) bySource.set(j.source, []);
      bySource.get(j.source).push(j);
    }
    for (const [src, rows] of bySource) {
      const ids = rows.map((r) => r.externalId);
      const existing = await query(
        `SELECT id, external_id FROM jobs WHERE source = ? AND external_id IN (${ids.map(() => '?').join(',')})`,
        [src, ...ids],
      );
      const known = new Map(existing.map((r) => [r.external_id, r.id]));

      if (known.size) {
        await query(
          `UPDATE jobs SET last_seen_at = ? WHERE id IN (${[...known.values()].map(() => '?').join(',')})`,
          [now, ...known.values()],
        );
        // Re-activate a job that was marked closed but has reappeared, unless
        // it is a duplicate of a better row (handled below for new rows only).
        await query(
          `UPDATE jobs j
              LEFT JOIN jobs better ON better.dedup_hash = j.dedup_hash AND better.id <> j.id AND better.is_active = 1
             SET j.is_active = 1
           WHERE j.id IN (${[...known.values()].map(() => '?').join(',')}) AND j.is_active = 0 AND better.id IS NULL`,
          [...known.values()],
        );
        updated += known.size;
      }

      const fresh = rows.filter((r) => !known.has(r.externalId));
      if (!fresh.length) continue;

      // A job already in the index from another feed is stored inactive, so
      // search shows it once — from the employer's own board where possible.
      const hashes = [...new Set(fresh.map((r) => r.dedupHash))];
      const dupes = await query(
        `SELECT id, dedup_hash, source FROM jobs WHERE is_active = 1 AND dedup_hash IN (${hashes.map(() => '?').join(',')})`,
        hashes,
      );
      const activeBy = new Map(dupes.map((d) => [d.dedup_hash, d]));
      const demote = [];
      const rowsOut = [];
      const batchHashes = new Set();
      for (const r of fresh) {
        const other = activeBy.get(r.dedupHash);
        let active = !batchHashes.has(r.dedupHash);
        if (other) {
          if (rank(r.source) < rank(other.source)) demote.push(other.id);
          else active = false;
        }
        if (active) batchHashes.add(r.dedupHash);
        rowsOut.push(rowValues(r, now, active));
      }
      if (demote.length) {
        await query(`UPDATE jobs SET is_active = 0 WHERE id IN (${demote.map(() => '?').join(',')})`, demote);
      }
      // Descriptions run to 20 KB each, so a multi-row INSERT is cut by size
      // rather than count: shared MySQL hosts keep max_allowed_packet small,
      // and one oversized statement fails the whole batch.
      const tuple = `(${COLUMNS.map(() => '?').join(',')})`;
      let chunk = [];
      let bytes = 0;
      const flush = async () => {
        if (!chunk.length) return;
        await query(
          `INSERT INTO jobs (${COLUMNS.join(',')}) VALUES ${chunk.map(() => tuple).join(',')}
           ON DUPLICATE KEY UPDATE last_seen_at = VALUES(last_seen_at)`,
          chunk.flat(),
        );
        chunk = [];
        bytes = 0;
      };
      for (const v of rowsOut) {
        const size = v.reduce((n, x) => n + (typeof x === 'string' ? Buffer.byteLength(x) : 16), 0);
        if (bytes + size > 512 * 1024) await flush();
        chunk.push(v);
        bytes += size;
      }
      await flush();
      inserted += fresh.length;
    }
  }
  return { inserted, updated };
}

/**
 * Mark the jobs of one source that are already indexed as seen, and return
 * which external ids those were — so the ingester only normalises the rest.
 */
export async function touchKnown(source, externalIds, now = new Date()) {
  const known = new Set();
  for (let i = 0; i < externalIds.length; i += 500) {
    const ids = externalIds.slice(i, i + 500);
    if (!ids.length) continue;
    const rows = await query(
      `SELECT id, external_id, is_active FROM jobs WHERE source = ? AND external_id IN (${ids.map(() => '?').join(',')})`,
      [source, ...ids],
    );
    if (!rows.length) continue;
    rows.forEach((r) => known.add(r.external_id));
    await query(
      `UPDATE jobs SET last_seen_at = ? WHERE id IN (${rows.map(() => '?').join(',')})`,
      [now, ...rows.map((r) => r.id)],
    );
    const closed = rows.filter((r) => !Number(r.is_active)).map((r) => r.id);
    if (closed.length) {
      await query(
        `UPDATE jobs j
            LEFT JOIN jobs better ON better.dedup_hash = j.dedup_hash AND better.id <> j.id AND better.is_active = 1
           SET j.is_active = 1
         WHERE j.id IN (${closed.map(() => '?').join(',')}) AND better.id IS NULL AND j.posted_at > ?`,
        [...closed, new Date(now - 60 * DAY)],
      );
    }
  }
  return known;
}

/**
 * Close jobs a feed no longer lists.
 *
 * Company boards are full snapshots, so absence means the role is filled.
 * Aggregators are paged and partial, so for them absence means nothing and
 * age decides instead.
 */
export async function closeMissing({ source, board, runStartedAt }) {
  const base = source.split(':')[0];
  if (SNAPSHOT_SOURCES.has(base)) {
    const res = await query(
      'UPDATE jobs SET is_active = 0 WHERE source = ? AND source_board = ? AND is_active = 1 AND last_seen_at < ?',
      [base, board, runStartedAt],
    );
    return res.affectedRows || 0;
  }
  return 0;
}

/** Nightly: age out aggregator jobs and delete long-closed rows. */
export async function prune(now = new Date()) {
  const staleAggregator = await query(
    `UPDATE jobs SET is_active = 0
      WHERE is_active = 1 AND source NOT IN ('greenhouse','lever','ashby','smartrecruiters','workable','recruitee')
        AND (last_seen_at < ? OR posted_at < ?)`,
    [new Date(now - 4 * DAY), new Date(now - 60 * DAY)],
  );
  const deleted = await query(
    'DELETE FROM jobs WHERE (is_active = 0 AND last_seen_at < ?) OR posted_at < ? LIMIT 5000',
    [new Date(now - 45 * DAY), new Date(now - 150 * DAY)],
  );
  const runs = await query('DELETE FROM job_source_runs WHERE started_at < ? LIMIT 5000', [new Date(now - 14 * DAY)]);
  return {
    deactivated: staleAggregator.affectedRows || 0,
    deleted: deleted.affectedRows || 0,
    runsDeleted: runs.affectedRows || 0,
  };
}

/* ------------------------------------------------------------- search */

const WORKPLACES = ['onsite', 'hybrid', 'remote'];
const TYPES = ['full_time', 'part_time', 'contract', 'internship', 'temporary'];
const SENIORITIES = ['intern', 'junior', 'mid', 'senior', 'lead', 'executive'];

/**
 * A free-text query → an InnoDB boolean-mode expression. Every word is
 * required and prefix-matched, so "react native dev" finds "Developer".
 * Words under three characters cannot be in the FULLTEXT index (min token
 * size), so they are returned separately and matched on the title with LIKE —
 * that is how "Go", "C#" and "UX" still work.
 */
function parseQuery(q, relaxed = false) {
  const words = String(q || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#.\s-]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[-.]+|[-.]+$/g, ''))
    .filter(Boolean)
    .slice(0, 8);
  const STOP = new Set(['and', 'or', 'the', 'for', 'with', 'job', 'jobs', 'in', 'at', 'of', 'a', 'an', 'وظيفة', 'وظائف', 'في']);
  const ft = [];
  const short = [];
  for (const w of words) {
    if (STOP.has(w)) continue;
    const token = w.replace(/[+#.]/g, '');
    if (token.length >= 3 && token === w) ft.push(relaxed ? `${token}*` : `+${token}*`);
    else short.push(w);
  }
  return { boolean: ft.join(' '), natural: words.join(' '), short };
}

/**
 * @param {object} f
 * @returns {{ where: string, params: any[], scoreSql: string, scoreParams: any[] }}
 */
function buildFilters(f) {
  const where = ['j.is_active = 1'];
  const params = [];
  let scoreSql = '0';
  let scoreParams = [];

  const pq = parseQuery(f.q, f.relaxed);
  if (pq.boolean) {
    where.push('MATCH(j.title, j.company, j.skills, j.description) AGAINST (? IN BOOLEAN MODE)');
    params.push(pq.boolean);
    scoreSql = '(MATCH(j.title, j.company, j.skills) AGAINST (?) * 3 + MATCH(j.title, j.company, j.skills, j.description) AGAINST (?))';
    scoreParams = [pq.natural, pq.natural];
  }
  for (const s of f.relaxed && pq.boolean ? [] : pq.short) {
    // A whole word of the title, not a substring: "go" must not find "Django".
    // POSIX classes, because MySQL 8 (ICU) and MariaDB (PCRE) share no \b.
    const word = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    where.push('(j.title REGEXP ? OR FIND_IN_SET(?, j.skills))');
    params.push(`(^|[^[:alnum:]])${word}([^[:alnum:]]|$)`, s === 'c#' ? 'csharp' : s === 'c++' ? 'cpp' : s);
  }

  const countries = (Array.isArray(f.country) ? f.country : [f.country]).filter((c) => /^[A-Z]{2}$/.test(String(c || '')));
  if (countries.length) {
    const inList = `j.country IN (${countries.map(() => '?').join(',')})`;
    // "Worldwide" remote jobs are open to anyone in any of those countries.
    where.push(f.includeWorldwide ? `(${inList} OR (j.country IS NULL AND j.workplace = 'remote'))` : inList);
    params.push(...countries);
  }
  if (f.city) {
    where.push('(j.city LIKE ? OR j.location LIKE ?)');
    params.push(`%${f.city}%`, `%${f.city}%`);
  }
  const wp = [].concat(f.workplace || []).filter((w) => WORKPLACES.includes(w));
  if (wp.length) {
    where.push(`j.workplace IN (${wp.map(() => '?').join(',')})`);
    params.push(...wp);
  }
  const types = [].concat(f.type || []).filter((t) => TYPES.includes(t));
  if (types.length) {
    where.push(`j.employment_type IN (${types.map(() => '?').join(',')})`);
    params.push(...types);
  }
  const sen = [].concat(f.seniority || []).filter((s) => SENIORITIES.includes(s));
  if (sen.length) {
    where.push(`j.seniority IN (${sen.map(() => '?').join(',')})`);
    params.push(...sen);
  }
  if (f.salaryOnly) where.push('(j.salary_min IS NOT NULL OR j.salary_max IS NOT NULL)');
  if (f.postedWithin) {
    where.push('j.posted_at >= ?');
    params.push(new Date(Date.now() - Number(f.postedWithin) * DAY));
  }
  if (f.seenSince) {
    // "New to us since", for alerts: a job posted last week but indexed an
    // hour ago is new to the person, and one posted today that they were
    // already sent is not.
    where.push('j.first_seen_at > ?');
    params.push(f.seenSince);
  }
  if (f.company) {
    where.push('j.company LIKE ?');
    params.push(`%${f.company}%`);
  }
  if (f.source) {
    where.push('j.source = ?');
    params.push(String(f.source));
  }
  if (f.language) {
    where.push('j.language = ?');
    params.push(String(f.language));
  }
  if (f.excludeIds?.length) {
    where.push(`j.id NOT IN (${f.excludeIds.map(() => '?').join(',')})`);
    params.push(...f.excludeIds);
  }
  return { where: where.join(' AND '), params, scoreSql, scoreParams };
}

const LIST_FIELDS = `j.id, j.source, j.source_board, j.title, j.company, j.company_logo, j.url, j.apply_url, j.location,
  j.country, j.city, j.workplace, j.employment_type, j.seniority, j.category, j.salary_min, j.salary_max,
  j.salary_currency, j.salary_period, j.skills, j.language, j.posted_at, LEFT(j.description, 320) AS snippet`;

export function toJobCard(r) {
  return {
    id: String(r.id),
    title: r.title,
    company: r.company,
    companyLogo: r.company_logo,
    url: r.url,
    applyUrl: r.apply_url || r.url,
    location: r.location,
    country: r.country,
    city: r.city,
    workplace: r.workplace,
    employmentType: r.employment_type,
    seniority: r.seniority,
    category: r.category,
    salary: r.salary_min || r.salary_max ? {
      min: r.salary_min ? Number(r.salary_min) : null,
      max: r.salary_max ? Number(r.salary_max) : null,
      currency: r.salary_currency,
      period: r.salary_period,
    } : null,
    skills: r.skills ? String(r.skills).split(',').filter(Boolean).slice(0, 12).map((k) => ({ key: k, label: skillLabel(k) })) : [],
    language: r.language,
    postedAt: r.posted_at instanceof Date ? r.posted_at.toISOString() : r.posted_at,
    source: r.source,
    sourceName: r.source === 'jsearch' && r.source_board ? r.source_board : (SOURCE_NAMES[r.source] || r.source),
    snippet: r.snippet ? String(r.snippet).replace(/\s+/g, ' ').trim() : undefined,
  };
}

/**
 * @param {object} f  filters (routes/jobs.js validates them)
 * @returns {Promise<{ total:number, page:number, pageSize:number, jobs:object[] }>}
 */
export async function searchJobs(f) {
  const out = await runSearch(f);
  // Every word is required, so a long query ("senior react developer dubai
  // fintech") can match nothing while each part matches plenty. Rather than an
  // empty page, fall back to any-word matching, best match first.
  if (!out.total && f.q && String(f.q).trim().split(/\s+/).length > 1 && !f.relaxed) {
    const loose = await runSearch({ ...f, relaxed: true, sort: f.sort === 'date' ? 'date' : 'relevance' });
    if (loose.total) return { ...loose, relaxed: true };
  }
  return out;
}

async function runSearch(f) {
  const page = Math.max(1, Math.min(50, Number(f.page) || 1));
  const pageSize = Math.max(1, Math.min(50, Number(f.pageSize) || 20));
  const { where, params, scoreSql, scoreParams } = buildFilters(f);

  let order;
  if (f.sort === 'salary') order = 'COALESCE(j.salary_max, j.salary_min) IS NULL, COALESCE(j.salary_max, j.salary_min) DESC, j.posted_at DESC';
  else if (f.sort === 'relevance' && scoreSql !== '0') order = `score DESC, j.posted_at DESC`;
  else if (scoreSql !== '0' && f.sort !== 'date') {
    // Relevance, with a gentle pull towards new postings: a strong match from
    // last month should not bury a good one from this morning.
    order = `(score / (1 + DATEDIFF(NOW(), j.posted_at) / 14)) DESC, j.posted_at DESC`;
  } else order = 'j.posted_at DESC';

  // Jobs the live feeds returned for this very search come first: they are
  // the ones confirmed open seconds ago.
  const boost = (f.boostIds || []).filter((id) => /^\d+$/.test(String(id))).slice(0, 300);
  const boostSql = boost.length ? `(j.id IN (${boost.map(() => '?').join(',')})) DESC, ` : '';

  const [rows, countRow] = await Promise.all([
    query(
      `SELECT ${LIST_FIELDS}, ${scoreSql} AS score FROM jobs j WHERE ${where} ORDER BY ${boostSql}${order} LIMIT ? OFFSET ?`,
      [...scoreParams, ...params, ...boost, pageSize, (page - 1) * pageSize],
    ),
    queryOne(`SELECT COUNT(*) AS n FROM jobs j WHERE ${where}`, params),
  ]);
  return {
    total: Number(countRow?.n || 0),
    page,
    pageSize,
    jobs: rows.map(toJobCard),
  };
}

/** How many jobs matching these filters reached the index after `since` — the "N new jobs" pill. */
export async function countNewSince(f, since) {
  const { where, params } = buildFilters({ ...f, seenSince: since });
  const row = await queryOne(`SELECT COUNT(*) AS n FROM jobs j WHERE ${where}`, params);
  return Number(row?.n || 0);
}

const facetCache = new Map();

/** Counts for the filter chips, cached briefly per query — they are the expensive part. */
export async function searchFacets(f) {
  const key = JSON.stringify({ ...f, page: 0, pageSize: 0, sort: 0 });
  const hit = facetCache.get(key);
  if (hit && hit.at > Date.now() - 5 * 60_000) return hit.value;

  const { where, params } = buildFilters({ ...f, country: null, workplace: null, seniority: null, type: null });
  const [countries, workplaces, seniorities, types] = await Promise.all([
    query(`SELECT j.country AS k, COUNT(*) AS n FROM jobs j WHERE ${where} AND j.country IS NOT NULL GROUP BY j.country ORDER BY n DESC LIMIT 40`, params),
    query(`SELECT j.workplace AS k, COUNT(*) AS n FROM jobs j WHERE ${where} GROUP BY j.workplace`, params),
    query(`SELECT j.seniority AS k, COUNT(*) AS n FROM jobs j WHERE ${where} AND j.seniority IS NOT NULL GROUP BY j.seniority`, params),
    query(`SELECT j.employment_type AS k, COUNT(*) AS n FROM jobs j WHERE ${where} AND j.employment_type IS NOT NULL GROUP BY j.employment_type`, params),
  ]);
  const shape = (rows) => rows.map((r) => ({ key: r.k, count: Number(r.n) }));
  const value = {
    countries: shape(countries),
    workplace: shape(workplaces),
    seniority: shape(seniorities),
    type: shape(types),
  };
  if (facetCache.size > 500) facetCache.clear();
  facetCache.set(key, { at: Date.now(), value });
  return value;
}

export async function getJob(id) {
  if (!/^\d{1,19}$/.test(String(id))) return null;
  const r = await queryOne(
    `SELECT ${LIST_FIELDS}, j.description, j.is_active, j.first_seen_at FROM jobs j WHERE j.id = ?`,
    [String(id)],
  );
  if (!r) return null;
  return {
    ...toJobCard(r),
    snippet: undefined,
    description: r.description,
    isActive: Boolean(r.is_active),
    skills: r.skills ? String(r.skills).split(',').filter(Boolean).map((k) => ({ key: k, label: skillLabel(k) })) : [],
  };
}

/** Raw row for matching and tailoring (no card shaping). */
export async function getJobRow(id) {
  if (!/^\d{1,19}$/.test(String(id))) return null;
  return queryOne('SELECT * FROM jobs WHERE id = ?', [String(id)]);
}

export async function similarJobs(job, limit = 6) {
  const q = job.title.split(/\s+/).slice(0, 4).join(' ');
  const res = await searchJobs({ q, country: job.country ? [job.country] : null, includeWorldwide: true, pageSize: limit + 1 });
  return res.jobs.filter((j) => j.id !== job.id).slice(0, limit);
}

/** Headline numbers for the landing page and the admin panel. */
let statsCache = null;
export async function indexStats() {
  if (statsCache && statsCache.at > Date.now() - 10 * 60_000) return statsCache.value;
  const [totals, countries, companies, latest] = await Promise.all([
    queryOne(`SELECT COUNT(*) AS jobs, SUM(workplace = 'remote') AS remote, SUM(posted_at >= ?) AS today FROM jobs WHERE is_active = 1`, [new Date(Date.now() - DAY)]),
    queryOne('SELECT COUNT(DISTINCT country) AS n FROM jobs WHERE is_active = 1 AND country IS NOT NULL'),
    queryOne('SELECT COUNT(DISTINCT company) AS n FROM jobs WHERE is_active = 1'),
    queryOne('SELECT MAX(last_seen_at) AS t FROM jobs'),
  ]);
  const value = {
    jobs: Number(totals?.jobs || 0),
    remote: Number(totals?.remote || 0),
    postedToday: Number(totals?.today || 0),
    countries: Number(countries?.n || 0),
    companies: Number(companies?.n || 0),
    updatedAt: latest?.t || null,
  };
  statsCache = { at: Date.now(), value };
  return value;
}

/** Per-source health for the admin panel. */
export async function sourceHealth() {
  const rows = await query(
    `SELECT r.source, r.started_at, r.finished_at, r.fetched, r.inserted, r.updated, r.ok, r.error
       FROM job_source_runs r
       JOIN (SELECT source, MAX(id) AS id FROM job_source_runs GROUP BY source) last ON last.id = r.id
      ORDER BY r.ok ASC, r.source ASC`,
  );
  const counts = await query(
    `SELECT CASE WHEN source IN ('greenhouse','lever','ashby','adzuna') THEN CONCAT(source, ':', source_board) ELSE source END AS s,
            COUNT(*) AS n
       FROM jobs WHERE is_active = 1 GROUP BY s`,
  );
  const by = new Map(counts.map((c) => [c.s, Number(c.n)]));
  return rows.map((r) => ({ ...r, active: by.get(r.source) || 0 }));
}

export async function logRun(entry) {
  try {
    await query(
      `INSERT INTO job_source_runs (source, started_at, finished_at, fetched, inserted, updated, ok, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [entry.source, entry.startedAt, entry.finishedAt, entry.fetched, entry.inserted, entry.updated, entry.ok ? 1 : 0, entry.error ? String(entry.error).slice(0, 500) : null],
    );
  } catch (err) {
    logger.warn('job run log failed', { message: err.message });
  }
}

export async function lastRuns() {
  const rows = await query(
    'SELECT source, MAX(started_at) AS last_started, MAX(CASE WHEN ok = 1 THEN started_at END) AS last_ok FROM job_source_runs GROUP BY source',
  );
  return new Map(rows.map((r) => [r.source, { lastStarted: r.last_started, lastOk: r.last_ok }]));
}
