/**
 * The signed-in career platform: profile and CV, matches, ATS checks against a
 * stored CV, AI tailoring and cover letters, CV versions and their downloads,
 * the application tracker, and saved searches with alerts.
 *
 * Billing follows the rest of the product. Deterministic features (matching,
 * ATS, the tracker, exports) are free. Model calls are a flat charge from the
 * same balance as interviews, free for subscribers, and refunded when the
 * model fails — see services/billing/minutes.js.
 */

import { Router } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import multer from 'multer';

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { requireUser } from '../middleware/auth.js';
import { aiLimiter, heavyAiLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { query, queryOne } from '../db/mysql.js';
import { CFG, chargeFlat, refundFlat } from '../services/billing/minutes.js';
import { flag } from '../services/appSettings.js';
import {
  extractCvProfile, tailorCv, writeCoverLetter, improveBullets, AiUnavailableError,
} from '../services/ai/index.js';
import { getJob, searchJobs } from '../services/jobs/store.js';
import { sanitizeCv, cvToText, headlineOf, emptyCv } from '../services/career/cv.js';
import { matchJob } from '../services/career/match.js';
import { analyzeAts } from '../services/career/ats.js';
import {
  renderCvHtml, renderLetterHtml, TEMPLATES, TEMPLATE_META, CV_LANGUAGES,
} from '../services/career/template.js';
import { exampleCv, exampleRoleList, EXAMPLE_ROLES } from '../services/career/examples.js';
import { renderCvDocx } from '../services/career/docx.js';
import { htmlToPdf, pdfAvailable } from '../services/career/pdf.js';
import { extractCvText, acceptsCvFile } from '../services/career/extract.js';
import {
  loadProfile, saveProfile, matchProfileOf, profileIsUsable,
} from '../services/career/profile.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) { cb(null, acceptsCvFile(file)); },
});

const idParam = z.string().regex(/^\d{1,19}$/);
const lang = z.enum(['ar', 'en', 'de', 'fr', 'es']);
const parseJson = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
};
const iso = (d) => (d instanceof Date ? d.toISOString() : d || null);

/** Tells the client this call was the free first use (header read by the app's toast). */
function res_free(req) {
  req.res?.set('X-Free-Use', '1');
}

/** The AI tools whose first use is free, once per account (migration 012). */
export const FREE_FIRST_USE = ['cv_import', 'cv_bullets', 'cv_tailor', 'cover_letter'];

/**
 * Take this person's free first use of a tool, if it is still there.
 * INSERT IGNORE on the primary key is the whole lock: of two parallel
 * requests exactly one inserts the row and is free.
 */
async function takeFreeUse(userId, feature) {
  if (!FREE_FIRST_USE.includes(feature) || !flag('career_first_use_free')) return false;
  try {
    const r = await query('INSERT IGNORE INTO career_free_uses (user_id, feature, used_at) VALUES (?, ?, ?)', [String(userId), feature, new Date()]);
    return (r.affectedRows || 0) === 1;
  } catch (err) {
    // Table missing (migration not applied yet) → charge as before, never fail the request.
    logger.warn('free first use unavailable', { message: err.message });
    return false;
  }
}

async function giveBackFreeUse(userId, feature) {
  await query('DELETE FROM career_free_uses WHERE user_id = ? AND feature = ?', [String(userId), feature]).catch(() => {});
}

/** Which tools still have their free first use, for the badges in the app. */
async function freeUsesLeft(userId) {
  if (!flag('career_first_use_free')) return Object.fromEntries(FREE_FIRST_USE.map((k) => [k, false]));
  const rows = await query('SELECT feature FROM career_free_uses WHERE user_id = ?', [String(userId)]).catch(() => null);
  if (!rows) return Object.fromEntries(FREE_FIRST_USE.map((k) => [k, false]));
  const used = new Set(rows.map((r) => r.feature));
  return Object.fromEntries(FREE_FIRST_USE.map((k) => [k, !used.has(k)]));
}

/**
 * Run a paid model call: charge, call, refund on failure, map the error.
 * The first use of each tool skips the charge entirely; a failed free use is
 * handed back so the person still gets it.
 */
async function paid(req, seconds, note, fn) {
  const free = await takeFreeUse(req.userId, note);
  const receipt = free ? null : await chargeFlat({ userId: req.userId, seconds, note });
  if (free) res_free(req);
  try {
    return await fn();
  } catch (err) {
    if (free) await giveBackFreeUse(req.userId, note);
    else await refundFlat(receipt, `${note}_failed`);
    if (err instanceof AiUnavailableError) {
      logger.error(`career ${note} failed`, { message: err.message });
      throw new HttpError(503, 'The AI service is temporarily unavailable. You were not charged.', undefined, 'AI_UNAVAILABLE');
    }
    throw err;
  }
}

/** A job to tailor against: one from the index, or one pasted in. */
async function resolveJob({ jobId, jobTitle, company, jobDescription }) {
  if (jobId) {
    const job = await getJob(jobId);
    if (!job) throw new HttpError(404, 'Job not found', undefined, 'JOB_NOT_FOUND');
    return job;
  }
  if (!jobDescription || jobDescription.trim().length < 80) {
    throw new HttpError(422, 'Paste the job description (at least a few lines).', undefined, 'JD_REQUIRED');
  }
  return { id: null, title: jobTitle || '', company: company || '', description: jobDescription };
}

async function requireProfile(userId) {
  const profile = await loadProfile(userId);
  if (!profile || !profileIsUsable(profile)) {
    throw new HttpError(409, 'Create your CV first.', undefined, 'PROFILE_REQUIRED');
  }
  return profile;
}

/* ============================================================ profile */

router.get('/profile', requireUser, asyncHandler(async (req, res) => {
  const profile = await loadProfile(req.userId);
  res.json({ profile: profile || { cv: emptyCv(), skills: [], targetTitle: '', targetCountry: '', openToRemote: true, years: null, updatedAt: null } , exists: Boolean(profile) });
}));

const profileSchema = z.object({
  cv: z.record(z.any()),
  targetTitle: z.string().max(191).optional().default(''),
  targetCountry: z.string().regex(/^[A-Z]{2}$/).or(z.literal('')).optional().default(''),
  openToRemote: z.boolean().optional().default(true),
});

router.put('/profile', requireUser, asyncHandler(async (req, res) => {
  const body = profileSchema.parse(req.body);
  const profile = await saveProfile(req.userId, body);
  res.json({ profile });
}));

/** CV file or pasted text → structured CV, by the model. Saved as the profile unless `save=0`. */
router.post('/profile/import', requireUser, heavyAiLimiter, upload.single('cv'), asyncHandler(async (req, res) => {
  let cvText = String(req.body?.cvText || '').slice(0, 40000).trim();
  if (req.file) {
    try {
      cvText = await extractCvText(req.file);
    } catch (err) {
      logger.warn('CV import parse failed', { message: err.message });
      throw new HttpError(422, 'Could not read this file. Upload a text-based PDF or a Word (.docx) file.', undefined, 'CV_UNREADABLE');
    }
  }
  if (cvText.length < 80) {
    throw new HttpError(422, 'No readable text found in the CV. If it is a scanned image, export it as a text PDF.', undefined, 'CV_EMPTY');
  }

  const out = await paid(req, CFG.cvPrepare(), 'cv_import', () => extractCvProfile({ cvText, userId: req.userId }));
  let profile = null;
  if (req.body?.save !== '0' && req.body?.save !== false) {
    const prev = await loadProfile(req.userId);
    profile = await saveProfile(req.userId, {
      cv: out.cv,
      targetTitle: prev?.targetTitle || headlineOf(out.cv),
      targetCountry: prev?.targetCountry || '',
      openToRemote: prev?.openToRemote ?? true,
    });
  }
  res.json({ cv: out.cv, profile });
}));

router.post('/improve-bullets', requireUser, aiLimiter, asyncHandler(async (req, res) => {
  const body = z.object({
    bullets: z.array(z.string().max(500)).min(1).max(10),
    title: z.string().max(200).optional().default(''),
    uiLanguage: lang.optional().default('en'),
  }).parse(req.body);
  const out = await paid(req, CFG.practiceAnswer(), 'cv_bullets', () => improveBullets({ ...body, userId: req.userId }));
  res.json({ bullets: out.bullets, tips: out.tips });
}));

/* ============================================================ matching */

/**
 * Recommended jobs: searched by the person's target title in their country
 * (plus remote-anywhere jobs when they are open to remote), then ranked by the
 * deterministic match score.
 */
router.get('/matches', requireUser, asyncHandler(async (req, res) => {
  const profile = await requireProfile(req.userId);
  const mp = matchProfileOf(profile);
  const title = (profile.targetTitle || headlineOf(profile.cv)).split(/[,|/(–-]/)[0].trim().split(/\s+/).slice(0, 3).join(' ');
  const country = /^[A-Z]{2}$/.test(String(req.query.country || '')) ? req.query.country : profile.targetCountry;
  const remote = req.query.remote === '1';

  const base = {
    q: title,
    country: country ? [country] : [],
    includeWorldwide: profile.openToRemote,
    workplace: remote ? ['remote'] : [],
    postedWithin: 30,
    pageSize: 50,
  };
  let { jobs } = await searchJobs(base);
  // A rare title in a small market: widen to anywhere before giving up.
  if (jobs.length < 10 && country) jobs = jobs.concat((await searchJobs({ ...base, country: [], workplace: ['remote'] })).jobs);

  const tracked = await query('SELECT job_id, status FROM job_applications WHERE user_id = ? AND job_id IS NOT NULL', [String(req.userId)]);
  const status = new Map(tracked.map((t) => [String(t.job_id), t.status]));

  const seen = new Set();
  const ranked = jobs
    .filter((j) => (seen.has(j.id) ? false : seen.add(j.id)))
    .map((j) => {
      const m = matchJob(mp, j);
      return { ...j, match: { score: m.score, missing: m.missing.slice(0, 4).map((s) => s.label) }, tracked: status.get(j.id) || null };
    })
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, 30);

  res.json({ query: { title, country: country || null }, jobs: ranked });
}));

/** Full fit for one job: match breakdown plus an ATS check of the master CV against it. */
router.get('/match/:jobId', requireUser, asyncHandler(async (req, res) => {
  const jobId = idParam.parse(req.params.jobId);
  const profile = await requireProfile(req.userId);
  const job = await getJob(jobId);
  if (!job) throw new HttpError(404, 'Job not found', undefined, 'JOB_NOT_FOUND');
  const match = matchJob(matchProfileOf(profile), job);
  const ats = analyzeAts({ cv: profile.cv, cvText: cvToText(profile.cv), jobDescription: job.description, jobTitle: job.title });
  res.json({ match, ats });
}));

/** ATS check of a stored CV (the master, or a version) against a job. */
router.post('/ats', requireUser, asyncHandler(async (req, res) => {
  const body = z.object({
    versionId: idParam.optional(),
    jobId: idParam.optional(),
    jobTitle: z.string().max(200).optional().default(''),
    jobDescription: z.string().max(20000).optional().default(''),
  }).parse(req.body);

  let cv;
  if (body.versionId) {
    const v = await queryOne('SELECT data FROM cv_versions WHERE id = ? AND user_id = ?', [body.versionId, String(req.userId)]);
    if (!v) throw new HttpError(404, 'CV version not found');
    cv = sanitizeCv(parseJson(v.data));
  } else {
    cv = (await requireProfile(req.userId)).cv;
  }
  let { jobTitle, jobDescription } = body;
  if (body.jobId) {
    const job = await getJob(body.jobId);
    if (job) { jobTitle = jobTitle || job.title; jobDescription = jobDescription || job.description; }
  }
  res.json(analyzeAts({ cv, cvText: cvToText(cv), jobDescription, jobTitle }));
}));

/* ============================================================ tailoring */

const jobInput = {
  jobId: idParam.optional(),
  jobTitle: z.string().max(200).optional().default(''),
  company: z.string().max(200).optional().default(''),
  jobDescription: z.string().max(20000).optional().default(''),
};

/**
 * Tailor the master CV to a job and save it as a new version, optionally with
 * a cover letter. One charge covers both: a letter is part of applying.
 */
router.post('/tailor', requireUser, heavyAiLimiter, asyncHandler(async (req, res) => {
  const body = z.object({
    ...jobInput,
    cvLanguage: lang.optional().default('en'),
    uiLanguage: lang.optional().default('en'),
    template: z.enum(TEMPLATES).optional().default('classic'),
    withLetter: z.boolean().optional().default(false),
    tone: z.enum(['professional', 'warm', 'confident', 'concise']).optional().default('professional'),
  }).parse(req.body);

  const profile = await requireProfile(req.userId);
  const job = await resolveJob(body);
  const before = analyzeAts({ cv: profile.cv, cvText: cvToText(profile.cv), jobDescription: job.description, jobTitle: job.title });

  const out = await paid(req, CFG.cvPrepare(), 'cv_tailor', async () => {
    const t = await tailorCv({ cv: profile.cv, job, cvLanguage: body.cvLanguage, uiLanguage: body.uiLanguage, userId: req.userId });
    let letter = null;
    if (body.withLetter) {
      letter = await writeCoverLetter({ cv: t.cv, job, language: body.cvLanguage, tone: body.tone, userId: req.userId });
    }
    return { t, letter };
  });

  const after = analyzeAts({ cv: out.t.cv, cvText: cvToText(out.t.cv), jobDescription: job.description, jobTitle: job.title });
  const now = new Date();
  const title = [job.title, job.company].filter(Boolean).join(' — ').slice(0, 191) || 'Tailored CV';
  const ins = await query(
    `INSERT INTO cv_versions (user_id, job_id, title, template, language, data, cover_letter, ats_score, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [String(req.userId), job.id || null, title, body.template, body.cvLanguage, JSON.stringify(out.t.cv), out.letter?.letter || null, after.score, now, now],
  );

  res.json({
    version: { id: String(ins.insertId), title, template: body.template, language: body.cvLanguage, jobId: job.id || null, cv: out.t.cv, coverLetter: out.letter?.letter || null, atsScore: after.score },
    changes: out.t.changes,
    gaps: out.t.gaps,
    questions: out.t.questions,
    ats: { before: before.score, after: after.score, report: after },
  });
}));

router.post('/cover-letter', requireUser, aiLimiter, asyncHandler(async (req, res) => {
  const body = z.object({
    ...jobInput,
    versionId: idParam.optional(),
    language: lang.optional().default('en'),
    tone: z.enum(['professional', 'warm', 'confident', 'concise']).optional().default('professional'),
  }).parse(req.body);

  let cv;
  let version = null;
  if (body.versionId) {
    version = await queryOne('SELECT id, job_id, data FROM cv_versions WHERE id = ? AND user_id = ?', [body.versionId, String(req.userId)]);
    if (!version) throw new HttpError(404, 'CV version not found');
    cv = sanitizeCv(parseJson(version.data));
  } else {
    cv = (await requireProfile(req.userId)).cv;
  }
  const job = await resolveJob({ ...body, jobId: body.jobId || (version?.job_id ? String(version.job_id) : undefined) });
  const out = await paid(req, CFG.practiceAnswer(), 'cover_letter', () => writeCoverLetter({ cv, job, language: body.language, tone: body.tone, userId: req.userId }));
  if (version) {
    await query('UPDATE cv_versions SET cover_letter = ?, updated_at = ? WHERE id = ?', [out.letter, new Date(), String(version.id)]);
  }
  res.json({ subject: out.subject, letter: out.letter });
}));

/* ============================================================ versions */

function versionOut(r, withData = false) {
  return {
    id: String(r.id),
    jobId: r.job_id ? String(r.job_id) : null,
    title: r.title,
    template: r.template,
    language: r.language,
    atsScore: r.ats_score,
    hasLetter: Boolean(r.cover_letter),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    ...(withData ? { cv: sanitizeCv(parseJson(r.data)), coverLetter: r.cover_letter || '' } : {}),
  };
}

router.get('/versions', requireUser, asyncHandler(async (req, res) => {
  const rows = await query(
    'SELECT id, job_id, title, template, language, ats_score, cover_letter IS NOT NULL AS cover_letter, created_at, updated_at FROM cv_versions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100',
    [String(req.userId)],
  );
  res.json({ versions: rows.map((r) => versionOut(r)) });
}));

router.get('/versions/:id', requireUser, asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const r = await queryOne('SELECT * FROM cv_versions WHERE id = ? AND user_id = ?', [id, String(req.userId)]);
  if (!r) throw new HttpError(404, 'CV version not found');
  res.json({ version: versionOut(r, true) });
}));

/** A copy of the master CV, to edit by hand (e.g. a second language). */
router.post('/versions', requireUser, asyncHandler(async (req, res) => {
  const body = z.object({
    title: z.string().min(1).max(191),
    template: z.enum(TEMPLATES).optional().default('classic'),
    language: lang.optional().default('en'),
    cv: z.record(z.any()).optional(),
  }).parse(req.body);
  const cv = body.cv ? sanitizeCv(body.cv) : (await requireProfile(req.userId)).cv;
  const now = new Date();
  const ins = await query(
    'INSERT INTO cv_versions (user_id, title, template, language, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [String(req.userId), body.title, body.template, body.language, JSON.stringify(cv), now, now],
  );
  res.status(201).json({ id: String(ins.insertId) });
}));

router.put('/versions/:id', requireUser, asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const body = z.object({
    title: z.string().min(1).max(191).optional(),
    template: z.enum(TEMPLATES).optional(),
    language: lang.optional(),
    cv: z.record(z.any()).optional(),
    coverLetter: z.string().max(8000).optional(),
  }).parse(req.body);
  const r = await queryOne('SELECT id FROM cv_versions WHERE id = ? AND user_id = ?', [id, String(req.userId)]);
  if (!r) throw new HttpError(404, 'CV version not found');
  const sets = [];
  const params = [];
  if (body.title) { sets.push('title = ?'); params.push(body.title); }
  if (body.template) { sets.push('template = ?'); params.push(body.template); }
  if (body.language) { sets.push('language = ?'); params.push(body.language); }
  if (body.cv) { sets.push('data = ?'); params.push(JSON.stringify(sanitizeCv(body.cv))); }
  if (body.coverLetter !== undefined) { sets.push('cover_letter = ?'); params.push(body.coverLetter || null); }
  sets.push('updated_at = ?');
  params.push(new Date(), id);
  await query(`UPDATE cv_versions SET ${sets.join(', ')} WHERE id = ?`, params);
  res.json({ ok: true });
}));

router.delete('/versions/:id', requireUser, asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  await query('DELETE FROM cv_versions WHERE id = ? AND user_id = ?', [id, String(req.userId)]);
  await query('UPDATE job_applications SET cv_version_id = NULL WHERE cv_version_id = ? AND user_id = ?', [id, String(req.userId)]);
  res.json({ ok: true });
}));

/* ============================================================ exports */

/**
 * Downloads go through a short-lived signed link rather than the bearer
 * header, so the same URL works from a browser tab, the web app and the
 * native app's system browser (none of which can attach a header to a plain
 * navigation).
 */
router.post('/print-link', requireUser, asyncHandler(async (req, res) => {
  const body = z.object({
    kind: z.enum(['cv', 'letter']).optional().default('cv'),
    versionId: idParam.optional(),
    format: z.enum(['html', 'pdf', 'docx']).optional().default('pdf'),
    template: z.enum(TEMPLATES).optional(),
    language: lang.optional(),
  }).parse(req.body);
  if (body.kind === 'letter' && !body.versionId) throw new HttpError(422, 'A cover letter belongs to a CV version.');
  const token = jwt.sign(
    { type: 'print', sub: String(req.userId), k: body.kind, v: body.versionId || null, f: body.format, t: body.template || null, l: body.language || null },
    env.JWT_SECRET,
    { expiresIn: '15m' },
  );
  res.json({ url: `/api/career/print/${token}`, expiresIn: 900 });
}));

router.get('/print/:token', asyncHandler(async (req, res) => {
  let p;
  try {
    p = jwt.verify(req.params.token, env.JWT_SECRET);
  } catch {
    throw new HttpError(410, 'This download link has expired. Open it again from the app.');
  }
  if (p.type !== 'print') throw new HttpError(400, 'Invalid link');

  let cv;
  let template = p.t || 'classic';
  let language = p.l || 'en';
  let letter = '';
  let title = 'CV';
  if (p.v) {
    const r = await queryOne('SELECT * FROM cv_versions WHERE id = ? AND user_id = ?', [String(p.v), String(p.sub)]);
    if (!r) throw new HttpError(404, 'CV version not found');
    cv = sanitizeCv(parseJson(r.data));
    template = p.t || r.template;
    language = p.l || r.language;
    letter = r.cover_letter || '';
    title = r.title;
  } else {
    const profile = await loadProfile(p.sub);
    if (!profile) throw new HttpError(404, 'No CV yet');
    cv = profile.cv;
  }
  if (!CV_LANGUAGES.includes(language)) language = 'en';
  const fileBase = (cv.basics.name || 'CV').replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '_') || 'CV';

  res.set('Cache-Control', 'private, no-store');
  res.set('X-Robots-Tag', 'noindex');
  const sendPdf = async (html, name) => {
    const buf = await htmlToPdf(html);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}.pdf"; filename*=UTF-8''${encodeURIComponent(name)}.pdf`);
    return res.send(buf);
  };
  if (p.k === 'letter') {
    const html = renderLetterHtml({ letter, cv, lang: language, template });
    if (p.f === 'pdf' && pdfAvailable()) {
      try { return await sendPdf(html.replace(html.slice(html.indexOf('<div class="toolbar">'), html.indexOf('<div class="page">')), ''), `${fileBase}_cover_letter`); } catch { /* fall back to the page */ }
    }
    return res.type('html').send(html);
  }
  if (p.f === 'docx') {
    const buf = renderCvDocx(cv, { lang: language });
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(fileBase)}.docx"; filename*=UTF-8''${encodeURIComponent(fileBase)}.docx`);
    return res.send(buf);
  }
  // PDF: headless Chrome prints the very page the preview shows, so the file
  // matches the design exactly and keeps real, selectable text (what an ATS
  // reads), Arabic included. If the renderer is missing or fails, the same page
  // opens with the browser's print dialog instead.
  if (p.f === 'pdf' && pdfAvailable()) {
    try {
      return await sendPdf(renderCvHtml(cv, { template, lang: language, title: `${fileBase} — ${title}`, toolbar: false }), fileBase);
    } catch { /* fall back to the print page */ }
  }
  res.type('html').send(renderCvHtml(cv, { template, lang: language, title: `${fileBase} — ${title}`, toolbar: true, autoPrint: p.f === 'pdf' }));
}));

/* ================================================ templates & examples */

/** GET /api/career/templates — the gallery: every template with its name and pitch. Public. */
router.get('/templates', (_req, res) => {
  // Short: the list grows with new designs, and a browser holding an hour-old
  // copy shows the new gallery with old metadata (no photo flag, no categories).
  // Clients also ask with ?v=N, bumped when the shape changes.
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ templates: TEMPLATES.map((id) => ({ id, ...TEMPLATE_META[id] })) });
});

/**
 * GET /api/career/templates/:id/preview?lang=en&role=software_engineer
 * The template rendered with an example CV — what the gallery thumbnails and
 * the "Preview" button show. Public and cacheable: it holds no one's data.
 */
router.get('/templates/:id/preview', (req, res) => {
  const id = TEMPLATES.includes(req.params.id) ? req.params.id : 'classic';
  const language = req.query.lang === 'ar' ? 'ar' : 'en';
  const role = EXAMPLE_ROLES.includes(String(req.query.role)) ? String(req.query.role) : 'software_engineer';
  const { cv } = exampleCv({ role, lang: language, seed: 7 });
  res.set('Cache-Control', 'public, max-age=3600');
  res.set('X-Robots-Tag', 'noindex');
  res.type('html').send(renderCvHtml(cv, { template: id, lang: language, toolbar: false, title: TEMPLATE_META[id].nameEn }));
});

/** GET /api/career/examples — roles that have a ready example CV. Public. */
router.get('/examples', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ roles: exampleRoleList() });
});

/**
 * GET /api/career/examples/:role?lang=en — a complete example CV to start
 * from; `random` picks the role and the invented person. Free, no model call,
 * nothing saved: the builder loads it and the person edits and saves.
 */
router.get('/examples/:role', (req, res) => {
  const language = req.query.lang === 'ar' ? 'ar' : 'en';
  const role = req.params.role === 'random' ? undefined : req.params.role;
  if (role && !EXAMPLE_ROLES.includes(role)) {
    res.status(404).json({ error: 'Unknown example role', code: 'EXAMPLE_NOT_FOUND' });
    return;
  }
  res.set('Cache-Control', 'private, no-store');
  res.json(exampleCv({ role, lang: language }));
});

/* ============================================================ tracker */

const STATUSES = ['saved', 'applied', 'screening', 'interview', 'offer', 'accepted', 'rejected', 'withdrawn'];

function applicationOut(r) {
  return {
    id: String(r.id),
    jobId: r.job_id ? String(r.job_id) : null,
    title: r.title,
    company: r.company,
    url: r.url,
    location: r.location,
    status: r.status,
    notes: r.notes || '',
    cvVersionId: r.cv_version_id ? String(r.cv_version_id) : null,
    matchScore: r.match_score,
    appliedAt: iso(r.applied_at),
    nextActionAt: iso(r.next_action_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    jobActive: r.is_active == null ? null : Boolean(r.is_active),
  };
}

router.get('/applications', requireUser, asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT a.*, j.is_active FROM job_applications a LEFT JOIN jobs j ON j.id = a.job_id
      WHERE a.user_id = ? ORDER BY a.updated_at DESC LIMIT 500`,
    [String(req.userId)],
  );
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  rows.forEach((r) => { counts[r.status] += 1; });
  res.json({ applications: rows.map(applicationOut), counts });
}));

const appSchema = z.object({
  jobId: idParam.optional(),
  title: z.string().max(255).optional(),
  company: z.string().max(191).optional(),
  url: z.string().url().max(700).optional().or(z.literal('')),
  location: z.string().max(255).optional(),
  status: z.enum(STATUSES).optional(),
  notes: z.string().max(5000).optional(),
  cvVersionId: idParam.nullable().optional(),
  nextActionAt: z.string().datetime().nullable().optional(),
});

/** Track a job. For an indexed job this is an upsert: tracking it twice moves it. */
router.post('/applications', requireUser, asyncHandler(async (req, res) => {
  const body = appSchema.parse(req.body);
  const now = new Date();
  let { title, company, url, location } = body;
  let matchScore = null;
  if (body.jobId) {
    const job = await getJob(body.jobId);
    if (!job) throw new HttpError(404, 'Job not found', undefined, 'JOB_NOT_FOUND');
    title = job.title; company = job.company; url = job.applyUrl || job.url; location = job.location;
    const profile = await loadProfile(req.userId).catch(() => null);
    if (profileIsUsable(profile)) matchScore = matchJob(matchProfileOf(profile), job).score;
  }
  if (!title || !company) throw new HttpError(422, 'Job title and company are required.');
  const status = body.status || 'saved';
  const ins = await query(
    `INSERT INTO job_applications (user_id, job_id, title, company, url, location, status, notes, cv_version_id, match_score, applied_at, next_action_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), status = VALUES(status), updated_at = VALUES(updated_at),
       applied_at = COALESCE(applied_at, VALUES(applied_at))`,
    [
      String(req.userId), body.jobId || null, title.slice(0, 255), company.slice(0, 191), url || null, location || null,
      status, body.notes || null, body.cvVersionId || null, matchScore,
      status === 'saved' ? null : now, body.nextActionAt ? new Date(body.nextActionAt) : null, now, now,
    ],
  );
  const row = await queryOne('SELECT a.*, j.is_active FROM job_applications a LEFT JOIN jobs j ON j.id = a.job_id WHERE a.id = ?', [String(ins.insertId)]);
  res.status(201).json({ application: applicationOut(row) });
}));

router.patch('/applications/:id', requireUser, asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const body = appSchema.omit({ jobId: true }).parse(req.body);
  const cur = await queryOne('SELECT * FROM job_applications WHERE id = ? AND user_id = ?', [id, String(req.userId)]);
  if (!cur) throw new HttpError(404, 'Application not found');
  const sets = [];
  const params = [];
  const set = (col, v) => { sets.push(`${col} = ?`); params.push(v); };
  if (body.title) set('title', body.title);
  if (body.company) set('company', body.company);
  if (body.url !== undefined) set('url', body.url || null);
  if (body.location !== undefined) set('location', body.location || null);
  if (body.notes !== undefined) set('notes', body.notes || null);
  if (body.cvVersionId !== undefined) set('cv_version_id', body.cvVersionId || null);
  if (body.nextActionAt !== undefined) set('next_action_at', body.nextActionAt ? new Date(body.nextActionAt) : null);
  if (body.status) {
    set('status', body.status);
    if (body.status !== 'saved' && !cur.applied_at) set('applied_at', new Date());
  }
  set('updated_at', new Date());
  params.push(id);
  await query(`UPDATE job_applications SET ${sets.join(', ')} WHERE id = ?`, params);
  const row = await queryOne('SELECT a.*, j.is_active FROM job_applications a LEFT JOIN jobs j ON j.id = a.job_id WHERE a.id = ?', [id]);
  res.json({ application: applicationOut(row) });
}));

router.delete('/applications/:id', requireUser, asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  await query('DELETE FROM job_applications WHERE id = ? AND user_id = ?', [id, String(req.userId)]);
  res.json({ ok: true });
}));

/* ============================================================ saved searches */

const savedQuery = z.object({
  q: z.string().max(120).optional().default(''),
  country: z.string().max(200).optional().default(''),
  workplace: z.string().max(60).optional().default(''),
  type: z.string().max(100).optional().default(''),
  seniority: z.string().max(100).optional().default(''),
  salary: z.enum(['0', '1']).optional(),
}).strip();

function searchOut(r) {
  return { id: String(r.id), name: r.name, query: parseJson(r.query) || {}, frequency: r.frequency, lastSentAt: iso(r.last_sent_at), createdAt: iso(r.created_at) };
}

router.get('/searches', requireUser, asyncHandler(async (req, res) => {
  const rows = await query('SELECT * FROM saved_searches WHERE user_id = ? ORDER BY created_at DESC', [String(req.userId)]);
  res.json({ searches: rows.map(searchOut) });
}));

router.post('/searches', requireUser, asyncHandler(async (req, res) => {
  const body = z.object({
    name: z.string().min(1).max(120),
    query: savedQuery,
    frequency: z.enum(['off', 'daily', 'weekly']).optional().default('daily'),
  }).parse(req.body);
  const n = await queryOne('SELECT COUNT(*) AS n FROM saved_searches WHERE user_id = ?', [String(req.userId)]);
  if (Number(n?.n || 0) >= 20) throw new HttpError(422, 'You can keep up to 20 saved searches.');
  const now = new Date();
  // last_sent_at starts now, so the first alert carries only jobs posted after saving.
  const ins = await query(
    'INSERT INTO saved_searches (user_id, name, query, frequency, last_sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [String(req.userId), body.name, JSON.stringify(body.query), body.frequency, now, now],
  );
  const row = await queryOne('SELECT * FROM saved_searches WHERE id = ?', [String(ins.insertId)]);
  res.status(201).json({ search: searchOut(row) });
}));

router.patch('/searches/:id', requireUser, asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const body = z.object({
    name: z.string().min(1).max(120).optional(),
    query: savedQuery.optional(),
    frequency: z.enum(['off', 'daily', 'weekly']).optional(),
  }).parse(req.body);
  const sets = [];
  const params = [];
  if (body.name) { sets.push('name = ?'); params.push(body.name); }
  if (body.query) { sets.push('query = ?'); params.push(JSON.stringify(body.query)); }
  if (body.frequency) { sets.push('frequency = ?'); params.push(body.frequency); }
  if (!sets.length) return res.json({ ok: true });
  params.push(id, String(req.userId));
  await query(`UPDATE saved_searches SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, params);
  res.json({ ok: true });
}));

router.delete('/searches/:id', requireUser, asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  await query('DELETE FROM saved_searches WHERE id = ? AND user_id = ?', [id, String(req.userId)]);
  res.json({ ok: true });
}));

/** One-click "turn off this alert" from the email. Signed, so no sign-in is needed. */
router.get('/alerts/off/:token', asyncHandler(async (req, res) => {
  let p = null;
  try { p = jwt.verify(req.params.token, env.JWT_SECRET); } catch { /* expired or forged */ }
  const ok = p?.type === 'alert-off';
  if (ok) {
    await query("UPDATE saved_searches SET frequency = 'off' WHERE id = ? AND user_id = ?", [String(p.s), String(p.sub)]);
  }
  res.set('X-Robots-Tag', 'noindex');
  res.type('html').send(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Interprova</title></head>
<body style="font-family:system-ui,Segoe UI,Tahoma,sans-serif;background:#F1F5FB;margin:0;display:grid;place-items:center;min-height:100vh;color:#0F172A">
<div style="background:#fff;border:1px solid #E2E8F0;border-radius:16px;padding:32px;max-width:420px;text-align:center">
<h1 style="font-size:20px">${ok ? 'تم إيقاف التنبيه' : 'الرابط غير صالح'}</h1>
<p style="color:#475569">${ok ? 'لن تصلك رسائل أخرى لهذا البحث. يمكنك تفعيله من جديد من التطبيق.' : 'انتهت صلاحية الرابط. يمكنك إدارة التنبيهات من التطبيق.'}</p>
<p dir="ltr" style="color:#475569">${ok ? 'This alert is turned off. You can turn it back on in the app.' : 'This link has expired. Manage your alerts in the app.'}</p>
<p><a href="/jobs" style="color:#1A56E8">interprova.com/jobs</a></p></div></body></html>`);
}));

/* ============================================================ overview */

router.get('/overview', requireUser, asyncHandler(async (req, res) => {
  const uid = String(req.userId);
  const [profile, apps, versions, searches, freeUses] = await Promise.all([
    loadProfile(req.userId),
    query('SELECT status, COUNT(*) AS n FROM job_applications WHERE user_id = ? GROUP BY status', [uid]),
    queryOne('SELECT COUNT(*) AS n FROM cv_versions WHERE user_id = ?', [uid]),
    queryOne('SELECT COUNT(*) AS n FROM saved_searches WHERE user_id = ?', [uid]),
    freeUsesLeft(req.userId),
  ]);
  const ats = profile && profileIsUsable(profile) ? analyzeAts({ cv: profile.cv, cvText: cvToText(profile.cv) }).score : null;
  res.json({
    hasProfile: profileIsUsable(profile),
    targetTitle: profile?.targetTitle || (profile ? headlineOf(profile.cv) : ''),
    targetCountry: profile?.targetCountry || '',
    cvScore: ats,
    applications: Object.fromEntries(apps.map((a) => [a.status, Number(a.n)])),
    versions: Number(versions?.n || 0),
    savedSearches: Number(searches?.n || 0),
    freeUses,
  });
}));

/** GET /api/career/free-uses — which AI tools are still free to try once. */
router.get('/free-uses', requireUser, asyncHandler(async (req, res) => {
  res.json({ freeUses: await freeUsesLeft(req.userId) });
}));

export default router;
