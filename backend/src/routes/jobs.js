/**
 * Public job search — the index of jobs from every source, for the website and
 * the app alike. No sign-in needed to search, read a job, or check a CV with
 * the ATS checker; a signed-in caller additionally gets a match score on every
 * card, computed against their career profile.
 *
 * Every Apply goes to the employer's (or the source's) own page. We index and
 * link; we never take an application on someone else's behalf.
 */

import { Router } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import multer from 'multer';

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { atsCheckLimiter, jobSearchLimiter } from '../middleware/rateLimit.js';
import {
  searchJobs, searchFacets, getJob, similarJobs, indexStats, countNewSince,
} from '../services/jobs/store.js';
import { englishQuery } from '../services/jobs/queryLang.js';
import { liveSearch, liveSearchAvailable } from '../services/jobs/ingest.js';
import { countryName } from '../services/jobs/countries.js';
import { searchSchema, toFilters } from '../services/jobs/filters.js';
import { matchJob } from '../services/career/match.js';
import { analyzeAts } from '../services/career/ats.js';
import { loadProfile, matchProfileOf, profileIsUsable } from '../services/career/profile.js';
import { extractCvText, acceptsCvFile } from '../services/career/extract.js';

const router = Router();

/** The user, if the request carries a valid token; never an error if not. */
function optionalUser(req, _res, next) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    try {
      const p = jwt.verify(h.slice(7), env.JWT_SECRET);
      if (p.type === 'user') req.userId = BigInt(p.sub);
    } catch { /* anonymous */ }
  }
  next();
}

let arNames = null;
try { arNames = new Intl.DisplayNames(['ar'], { type: 'region' }); } catch { /* small-icu build */ }
function localCountryName(code, lang) {
  if (lang === 'ar' && arNames) {
    try { return arNames.of(code); } catch { /* fall through */ }
  }
  return countryName(code) || code;
}

async function withMatches(req, jobs) {
  if (!req.userId || !jobs.length) return { jobs, matched: false };
  const profile = await loadProfile(req.userId).catch(() => null);
  if (!profileIsUsable(profile)) return { jobs, matched: false };
  const mp = matchProfileOf(profile);
  return {
    jobs: jobs.map((j) => {
      const m = matchJob(mp, j);
      return { ...j, match: { score: m.score, missing: m.missing.slice(0, 4).map((s) => s.label) } };
    }),
    matched: true,
  };
}

/**
 * GET /api/jobs/search
 *
 * A search with words in it is LIVE: the feeds that take a query (Himalayas,
 * Jobicy, Remote OK, and JSearch / Adzuna / Jooble when their keys are set)
 * are asked at that moment, what they return is folded into the index, and
 * those jobs lead the page. The rest of the page is the index, which the
 * scheduler refreshes every few minutes and from which filled roles are
 * closed — so nothing shown is a stale copy kept for its own sake.
 *
 * Arabic queries are searched with their English job words («محاسب» →
 * accountant), because that is the language almost every posting is in.
 */
router.get('/search', jobSearchLimiter, optionalUser, asyncHandler(async (req, res) => {
  const f = toFilters(searchSchema.parse(req.query));
  const typed = f.q;
  const eq = englishQuery(f.q);
  f.q = eq.q;
  // «محاسب في دبي»: the place becomes the filter, unless one is already set.
  if (eq.country && !f.country.length) f.country = [eq.country];
  if (eq.remote && !f.workplace.length) f.workplace = ['remote'];

  let live = null;
  if (f.q && f.page <= 3 && liveSearchAvailable()) {
    const country = f.country.length === 1 ? f.country[0] : null;
    const remoteOnly = f.workplace.length === 1 && f.workplace[0] === 'remote';
    live = await Promise.race([
      liveSearch({ q: f.q, country, remoteOnly, page: f.page }).catch((err) => {
        logger.warn('live search', { message: err.message });
        return null;
      }),
      new Promise((r) => { setTimeout(() => r(null), 8000); }),
    ]);
    if (live?.ids?.length) f.boostIds = live.ids;
  }

  const result = await searchJobs(f);
  const liveSet = new Set(live?.ids || []);
  const { jobs, matched } = await withMatches(req, result.jobs.map((j) => (liveSet.has(j.id) ? { ...j, live: true } : j)));
  res.set('Cache-Control', 'private, no-store');
  res.json({
    ...result,
    jobs,
    matched,
    query: { typed, searched: f.q, translated: eq.translated, country: eq.country || null, remote: Boolean(eq.remote) },
    live: live ? {
      at: live.at,
      count: live.ids.length,
      sources: live.sources.filter((s) => s.ok).map((s) => s.label),
    } : false,
    checkedAt: new Date().toISOString(),
  });
}));

/**
 * GET /api/jobs/new-count?since=ISO&…filters
 *
 * How many jobs matching the current filters arrived since the page loaded —
 * the client polls this and offers "12 new jobs" instead of reshuffling the
 * list under the reader's thumb.
 */
router.get('/new-count', jobSearchLimiter, asyncHandler(async (req, res) => {
  const since = new Date(String(req.query.since || ''));
  if (Number.isNaN(since.getTime())) throw new HttpError(422, 'since must be an ISO date');
  const f = toFilters(searchSchema.parse(req.query));
  f.q = englishQuery(f.q).q;
  const floor = new Date(Date.now() - 7 * 86400_000);
  const n = await countNewSince(f, since < floor ? floor : since);
  res.set('Cache-Control', 'private, no-store');
  res.json({ count: n, checkedAt: new Date().toISOString() });
}));

router.get('/facets', asyncHandler(async (req, res) => {
  const f = toFilters(searchSchema.parse(req.query));
  f.q = englishQuery(f.q).q;
  const facets = await searchFacets(f);
  const lang = req.query.lang === 'ar' ? 'ar' : 'en';
  facets.countries = facets.countries.map((c) => ({ ...c, name: localCountryName(c.key, lang) }));
  res.set('Cache-Control', 'public, max-age=300');
  res.json(facets);
}));

router.get('/stats', asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=600');
  res.json(await indexStats());
}));

router.get('/:id(\\d+)', jobSearchLimiter, optionalUser, asyncHandler(async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) throw new HttpError(404, 'Job not found', undefined, 'JOB_NOT_FOUND');
  const similar = await similarJobs(job).catch(() => []);

  let match = null;
  if (req.userId) {
    const profile = await loadProfile(req.userId).catch(() => null);
    if (profileIsUsable(profile)) match = matchJob(matchProfileOf(profile), job);
  }
  res.set('Cache-Control', req.userId ? 'private, no-store' : 'public, max-age=300');
  res.json({ job, similar, match });
}));

/* ------------------------------------------------------- ATS checker */

/*
 * Public and deterministic: no model call, so it costs nothing to run and is
 * offered without an account. atsCheckLimiter caps the PDF parsing.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) { cb(null, acceptsCvFile(file)); },
});

const atsSchema = z.object({
  cvText: z.string().max(40000).optional().default(''),
  jobDescription: z.string().max(20000).optional().default(''),
  jobTitle: z.string().max(200).optional().default(''),
  jobId: z.string().regex(/^\d{1,19}$/).optional(),
});

router.post('/ats-check', atsCheckLimiter, upload.single('cv'), asyncHandler(async (req, res) => {
  const body = atsSchema.parse(req.body);
  let cvText = body.cvText.trim();
  if (req.file) {
    try {
      cvText = await extractCvText(req.file);
    } catch (err) {
      logger.warn('ATS check: CV parse failed', { message: err.message });
      throw new HttpError(422, 'Could not read this file. Upload a text-based PDF or a Word (.docx) file.', undefined, 'CV_UNREADABLE');
    }
  }
  if (cvText.length < 80) {
    throw new HttpError(422, 'No readable text found in the CV. If it is a scanned image, export it as a text PDF.', undefined, 'CV_EMPTY');
  }

  let { jobDescription, jobTitle } = body;
  if (body.jobId && !jobDescription) {
    const job = await getJob(body.jobId);
    if (job) { jobDescription = job.description || ''; jobTitle = jobTitle || job.title; }
  }

  const report = analyzeAts({ cvText, jobDescription, jobTitle });
  res.set('Cache-Control', 'no-store');
  res.json(report);
}));

export default router;
