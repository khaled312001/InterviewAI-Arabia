/**
 * Calendar integration: Google Calendar (with Meet links) and Google Tasks,
 * plus a provider-free .ics download for Outlook / Apple Calendar users.
 *
 *   GET    /calendar/status
 *   GET    /calendar/google/connect      → { url } for the consent screen
 *   GET    /calendar/google/callback     ← Google redirects here (no auth)
 *   DELETE /calendar/google              revoke + forget
 *   GET    /calendar/events?days=14      upcoming events, interviews flagged
 *   POST   /calendar/events              interview / practice / prep block
 *   GET    /calendar/tasks               open Google Tasks
 *   POST   /calendar/tasks               e.g. "Tailor CV for <role> at <company>"
 *   POST   /calendar/ics                 a standards-compliant .ics, no Google needed
 *
 * With no OAuth client secret configured every Google endpoint answers 503
 * `calendar_not_configured`, and /status says `configured: false`, so the app
 * hides the connect button rather than offering something that cannot work.
 */

import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';

import { logger } from '../utils/logger.js';
import { requireUser } from '../middleware/auth.js';
import { calendarLimiter, calendarWriteLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { query, queryOne } from '../db/mysql.js';
import { getJob } from '../services/jobs/store.js';
import { buildIcs } from '../services/calendar/ics.js';
import { findJoinLink, looksLikeInterview, plainDescription } from '../services/calendar/detect.js';
import {
  isConfigured, requireConfigured, buildAuthUrl, verifyState, exchangeCode, saveConnection,
  getConnection, disconnect, listEvents, insertEvent, listTasks, insertTask,
  resolveReturnTo, returnUrl, defaultReturn, publicOrigin,
} from '../services/calendar/google.js';

const router = Router();

const idParam = z.string().regex(/^\d{1,19}$/);
const iso = (d) => (d instanceof Date ? d.toISOString() : d || null);

/* ============================================================== status */

router.get('/status', requireUser, calendarLimiter, asyncHandler(async (req, res) => {
  const configured = isConfigured();
  const conn = await getConnection(req.userId).catch((err) => {
    logger.warn('calendar status query failed', { message: err.message });
    return null;
  });
  res.json({
    configured,
    provider: 'google',
    connected: Boolean(conn),
    email: conn?.email ?? null,
    scopes: conn?.scopes ?? { calendar: false, tasks: false },
    connectedAt: conn?.connectedAt ?? null,
  });
}));

/* ======================================================= OAuth connect */

const connectQuery = z.object({
  target: z.enum(['web', 'native']).default('web'),
  origin: z.string().max(200).optional(),
});

router.get('/google/connect', requireUser, calendarLimiter, asyncHandler(async (req, res) => {
  requireConfigured();
  const q = connectQuery.parse(req.query);
  const returnTo = resolveReturnTo(q.target, q.origin);
  res.set('Cache-Control', 'no-store');
  res.json({ url: buildAuthUrl(req.userId, returnTo) });
}));

router.get('/google/callback', calendarLimiter, asyncHandler(async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const googleError = typeof req.query.error === 'string' ? req.query.error : '';

  // The access log (morgan, app.js) prints req.originalUrl when the response
  // finishes. The authorization code is in the query string, so drop it from
  // what gets logged — it is a credential for the next few minutes.
  req.originalUrl = `${req.baseUrl}${req.path}`;
  res.set('Cache-Control', 'no-store');

  let st;
  try {
    st = verifyState(state);
  } catch (err) {
    logger.warn('calendar oauth state rejected', { message: err.message });
    return res.redirect(303, returnUrl(defaultReturn(), 'error', 'expired'));
  }

  if (googleError || !code) {
    return res.redirect(303, returnUrl(st.returnTo, 'error', googleError === 'access_denied' ? 'denied' : 'google'));
  }
  if (!isConfigured()) return res.redirect(303, returnUrl(st.returnTo, 'error', 'not_configured'));

  try {
    const tokens = await exchangeCode(code, st.verifier);
    await saveConnection(st.userId, tokens);
  } catch (err) {
    logger.warn('calendar connect failed', { userId: st.userId, reason: err.code || err.message });
    return res.redirect(303, returnUrl(st.returnTo, 'error', 'exchange'));
  }
  logger.info('calendar connected', { userId: st.userId });
  return res.redirect(303, returnUrl(st.returnTo, 'connected'));
}));

router.delete('/google', requireUser, calendarLimiter, asyncHandler(async (req, res) => {
  const removed = await disconnect(req.userId);
  res.json({ ok: true, removed });
}));

/* ============================================================== events */

function eventOut(ev) {
  const allDay = Boolean(ev.start?.date && !ev.start?.dateTime);
  const join = findJoinLink(ev);
  const priv = ev.extendedProperties?.private || {};
  const description = plainDescription(ev.description, 600);
  return {
    id: ev.id,
    title: ev.summary || '',
    start: ev.start?.dateTime || ev.start?.date || null,
    end: ev.end?.dateTime || ev.end?.date || null,
    allDay,
    location: ev.location || null,
    description,
    joinUrl: join?.url ?? null,
    joinProvider: join?.provider ?? null,
    looksLikeInterview: priv.interprovaKind === 'interview'
      || (priv.interprovaKind ? false : looksLikeInterview(ev.summary, ev.description, ev.location)),
    kind: priv.interprovaKind || null,
    company: priv.interprovaCompany || null,
    role: priv.interprovaRole || null,
    htmlLink: ev.htmlLink || null,
    organizer: ev.organizer?.self ? null : (ev.organizer?.displayName || ev.organizer?.email || null),
  };
}

router.get('/events', requireUser, calendarLimiter, asyncHandler(async (req, res) => {
  requireConfigured();
  const days = z.coerce.number().int().min(1).max(60).default(14).parse(req.query.days);
  const now = new Date();
  const items = await listEvents(req.userId, {
    timeMin: now,
    timeMax: new Date(now.getTime() + days * 86_400_000),
  });
  const events = items
    .filter((ev) => ev.status !== 'cancelled')
    // An invitation the person declined is not on their schedule.
    .filter((ev) => !(ev.attendees || []).some((a) => a.self && a.responseStatus === 'declined'))
    .map(eventOut);
  res.json({ events, days });
}));

const eventSchema = z.object({
  kind: z.enum(['interview', 'practice', 'prep']).default('interview'),
  title: z.string().trim().max(200).optional(),
  company: z.string().trim().max(191).optional(),
  role: z.string().trim().max(255).optional(),
  start: z.string().datetime({ offset: true }),
  durationMinutes: z.coerce.number().int().min(10).max(480).default(60),
  timeZone: z.string().max(64).optional(),
  location: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(4000).optional(),
  addMeet: z.boolean().optional().default(false),
  jobId: idParam.optional(),
  applicationId: idParam.optional(),
  language: z.enum(['en', 'ar']).optional().default('en'),
});

function validTimeZone(tz) {
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return null;
  }
}

const COPY = {
  en: {
    interview: ({ role, company }) => (role && company ? `Interview: ${role} at ${company}`
      : company ? `Interview with ${company}` : role ? `Interview: ${role}` : 'Job interview'),
    practice: () => 'Mock interview practice',
    prep: ({ role, company }) => (role && company ? `Interview prep: ${role} at ${company}`
      : company ? `Interview prep: ${company}` : 'Interview prep'),
    role: 'Role', company: 'Company',
    prepare: 'Prepare with Interprova (mock interview, live assistant)',
    practiceLine: 'Practice a mock interview on Interprova',
    job: 'Job posting',
  },
  ar: {
    interview: ({ role, company }) => (role && company ? `مقابلة عمل: ${role} في ${company}`
      : company ? `مقابلة عمل مع ${company}` : role ? `مقابلة عمل: ${role}` : 'مقابلة عمل'),
    practice: () => 'تدريب على مقابلة تجريبية',
    prep: ({ role, company }) => (role && company ? `تحضير للمقابلة: ${role} في ${company}`
      : company ? `تحضير للمقابلة: ${company}` : 'تحضير للمقابلة'),
    role: 'الوظيفة', company: 'الشركة',
    prepare: 'استعد مع Interprova (مقابلة تجريبية ومساعد مباشر)',
    practiceLine: 'تدرّب على مقابلة تجريبية في Interprova',
    job: 'إعلان الوظيفة',
  },
};

/** Title, description and times shared by the Google event and the .ics. */
function compose(body) {
  const c = COPY[body.language] || COPY.en;
  const start = new Date(body.start);
  if (Number.isNaN(start.getTime())) throw new HttpError(422, 'Invalid start time');
  const end = new Date(start.getTime() + body.durationMinutes * 60_000);
  const summary = body.title || c[body.kind]({ role: body.role, company: body.company });

  const appLink = `${publicOrigin()}/app/`;
  const lines = [];
  if (body.role) lines.push(`${c.role}: ${body.role}`);
  if (body.company) lines.push(`${c.company}: ${body.company}`);
  if (body.notes) lines.push('', body.notes);
  if (body.jobId) lines.push('', `${c.job}: ${publicOrigin()}/jobs/${body.jobId}`);
  lines.push('', `${body.kind === 'practice' ? c.practiceLine : c.prepare}: ${appLink}`);

  return {
    summary: summary.slice(0, 250),
    description: lines.join('\n').trim(),
    start,
    end,
    location: body.location || '',
    url: appLink,
  };
}

/**
 * The tracker row an interview belongs to, checked BEFORE anything is written
 * so a bad id fails the request instead of leaving an orphan event behind.
 */
async function resolveApplication(userId, { applicationId, jobId }) {
  const uid = String(userId);
  if (applicationId) {
    const row = await queryOne('SELECT id, status, applied_at FROM job_applications WHERE id = ? AND user_id = ?', [applicationId, uid]);
    if (!row) throw new HttpError(404, 'Application not found', undefined, 'APPLICATION_NOT_FOUND');
    return { row };
  }
  if (jobId) {
    const row = await queryOne('SELECT id, status, applied_at FROM job_applications WHERE job_id = ? AND user_id = ?', [jobId, uid]);
    if (row) return { row };
    const job = await getJob(jobId);
    if (!job) throw new HttpError(404, 'Job not found', undefined, 'JOB_NOT_FOUND');
    return { job };
  }
  return null;
}

/** Move the tracker to "interview" and remember when it is. */
async function linkTracker(userId, target, jobId, start) {
  if (!target) return null;
  const uid = String(userId);
  const now = new Date();
  let id;
  if (target.row) {
    id = String(target.row.id);
    const early = ['saved', 'applied', 'screening'].includes(target.row.status);
    await query(
      `UPDATE job_applications
          SET next_action_at = ?, status = ?, applied_at = COALESCE(applied_at, ?), updated_at = ?
        WHERE id = ? AND user_id = ?`,
      [start, early ? 'interview' : target.row.status, now, now, id, uid],
    );
  } else {
    const job = target.job;
    const ins = await query(
      `INSERT INTO job_applications (user_id, job_id, title, company, url, location, status, applied_at, next_action_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'interview', ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), next_action_at = VALUES(next_action_at), updated_at = VALUES(updated_at)`,
      [uid, jobId, String(job.title).slice(0, 255), String(job.company).slice(0, 191),
        job.applyUrl || job.url || null, job.location || null, now, start, now, now],
    );
    id = String(ins.insertId);
  }
  const row = await queryOne('SELECT id, status, next_action_at FROM job_applications WHERE id = ?', [id]);
  return row ? { id: String(row.id), status: row.status, nextActionAt: iso(row.next_action_at) } : null;
}

router.post('/events', requireUser, calendarWriteLimiter, asyncHandler(async (req, res) => {
  requireConfigured();
  const body = eventSchema.parse(req.body);
  const ev = compose(body);
  const timeZone = validTimeZone(body.timeZone);
  const target = body.kind === 'interview' ? await resolveApplication(req.userId, body) : null;

  const priv = { interprovaKind: body.kind };
  if (body.company) priv.interprovaCompany = body.company.slice(0, 120);
  if (body.role) priv.interprovaRole = body.role.slice(0, 120);
  if (body.jobId) priv.interprovaJobId = body.jobId;
  if (body.applicationId) priv.interprovaApplicationId = body.applicationId;

  const resource = {
    summary: ev.summary,
    description: ev.description,
    ...(ev.location ? { location: ev.location } : {}),
    start: { dateTime: ev.start.toISOString(), ...(timeZone ? { timeZone } : {}) },
    end: { dateTime: ev.end.toISOString(), ...(timeZone ? { timeZone } : {}) },
    reminders: {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 1440 }, { method: 'popup', minutes: 30 }],
    },
    source: { title: 'Interprova', url: ev.url },
    extendedProperties: { private: priv },
    ...(body.addMeet ? {
      conferenceData: {
        createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } },
      },
    } : {}),
  };

  const created = await insertEvent(req.userId, resource, { withMeet: body.addMeet });
  const application = await linkTracker(req.userId, target, body.jobId, ev.start).catch((err) => {
    // The event exists; failing the whole request now would invite a retry
    // that creates a duplicate. Report the tracker as unlinked instead.
    logger.warn('calendar tracker link failed', { message: err.message });
    return null;
  });
  res.status(201).json({ event: eventOut(created || {}), application });
}));

/* =============================================================== tasks */

router.get('/tasks', requireUser, calendarLimiter, asyncHandler(async (req, res) => {
  requireConfigured();
  const items = await listTasks(req.userId);
  const tasks = items
    .filter((tk) => tk.status !== 'completed' && tk.title)
    .map((tk) => ({
      id: tk.id,
      title: tk.title,
      notes: tk.notes || '',
      due: tk.due ? String(tk.due).slice(0, 10) : null,
      webViewLink: tk.webViewLink || null,
    }))
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  res.json({ tasks });
}));

const taskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(4000).optional(),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  jobId: idParam.optional(),
});

router.post('/tasks', requireUser, calendarWriteLimiter, asyncHandler(async (req, res) => {
  requireConfigured();
  const body = taskSchema.parse(req.body);
  const notes = [body.notes, body.jobId ? `${publicOrigin()}/jobs/${body.jobId}` : '', `${publicOrigin()}/app/`]
    .filter(Boolean).join('\n\n');
  // Google Tasks keeps only the DATE of `due`; the time part must still be a
  // valid RFC 3339 timestamp, and midnight UTC is what Google itself writes.
  const created = await insertTask(req.userId, {
    title: body.title,
    notes: notes.slice(0, 8000),
    ...(body.due ? { due: `${body.due}T00:00:00.000Z` } : {}),
  });
  res.status(201).json({
    task: {
      id: created?.id ?? null,
      title: created?.title ?? body.title,
      notes: created?.notes ?? notes,
      due: created?.due ? String(created.due).slice(0, 10) : body.due ?? null,
      webViewLink: created?.webViewLink ?? null,
    },
  });
}));

/* ================================================================= ics */

router.post('/ics', requireUser, calendarWriteLimiter, asyncHandler(async (req, res) => {
  const body = eventSchema.parse(req.body);
  const ev = compose(body);
  const target = body.kind === 'interview' ? await resolveApplication(req.userId, body) : null;

  const ics = buildIcs({
    uid: `${crypto.randomUUID()}@${new URL(publicOrigin()).hostname}`,
    start: ev.start,
    end: ev.end,
    summary: ev.summary,
    description: ev.description,
    location: ev.location,
    url: ev.url,
    alarmsMinutes: [1440, 30],
  });

  await linkTracker(req.userId, target, body.jobId, ev.start).catch((err) => {
    logger.warn('calendar tracker link failed', { message: err.message });
  });

  const day = ev.start.toISOString().slice(0, 10).replace(/-/g, '');
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="interprova-${body.kind}-${day}.ics"`);
  res.set('Cache-Control', 'no-store');
  res.send(ics);
}));

export default router;
