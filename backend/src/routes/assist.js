/**
 * Live Interview Assistant — help during a REAL interview.
 *
 * The phone listens to the room, the interviewer's questions are transcribed
 * live, and a suggested answer streams onto the screen in the candidate's own
 * voice, grounded in their CV and the job. The practice interview is the
 * rehearsal; this is the day itself.
 *
 *   POST /start          Opens the session: the billing clock, plus the job,
 *                        the CV and the notes parked on the session row.
 *   POST /:id/listen     A short-lived speech-to-text credential. Web clients
 *                        stream the microphone straight to Deepgram with it;
 *                        phones use the on-device recogniser and never call it.
 *   POST /:id/tick       The clock. Cheap, no AI, every 15 seconds while live.
 *   POST /:id/answer     Streams one suggested answer (server-sent events).
 *   POST /:id/end        Settles the clock.
 *
 * BILLING IS THE INTERVIEW'S, NOT A NEW ONE. A session is a `meeting_sessions`
 * row with `client = 'assist'`, metered by services/billing/meetings.js exactly
 * like a practice interview: wall-clock while it is live, a turn floor on every
 * answer, ticks that stop while the user pauses (a gap past the max-gap is
 * billed at zero), a goodwill closing answer when the balance runs out, and
 * the turn floor reversed when the model fails. One live meeting per user
 * still holds: opening this ends a practice interview on another tab, and the
 * other way round. No new table, no new column — `voice_context` (migration
 * 009) already holds per-meeting context the client cannot rewrite.
 *
 * `category_id` is NOT NULL on that table and has no foreign key; assistant
 * sessions carry ASSIST_CATEGORY_ID (0), which no real category uses.
 */

import { Router } from 'express';
import { z } from 'zod';

import { logger } from '../utils/logger.js';
import { requireUser } from '../middleware/auth.js';
import { aiLimiter, tickLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { prisma } from '../db/prisma.js';
import { AiUnavailableError } from '../services/ai/index.js';
import { quotaError, loadBalanceUser, balanceSnapshot } from '../services/billing/minutes.js';
import {
  startMeeting, advanceMeeting, endMeeting, reverseTurnFloor,
  readMeeting, alreadyClosed, meetingExpired,
} from '../services/billing/meetings.js';
import { getJob } from '../services/jobs/store.js';
import { loadProfile, profileIsUsable } from '../services/career/profile.js';
import { cvToText } from '../services/career/cv.js';
import { isConfigured as sttConfigured, grantToken } from '../services/voice/agent.js';
import { streamAnswer, STYLES, MODES } from '../services/assist/answer.js';

const router = Router();

export const ASSIST_CLIENT = 'assist';
const ASSIST_CATEGORY_ID = 0;

/** Deepgram's streaming endpoint. Here rather than in the client: one edit. */
const LISTEN_URL = 'wss://api.deepgram.com/v1/listen';

const installIdOf = (req) => req.get('x-install-id') || null;

const bigId = (raw) => {
  try { return BigInt(raw); } catch { throw new HttpError(400, 'Invalid session id'); }
};

const parseContext = (raw) => {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
};

/**
 * The assistant session this request is about, or the reason it cannot be
 * used. A practice interview's id is refused: its context is an interviewer's,
 * not a candidate's.
 */
async function assistSession(req) {
  const meeting = await readMeeting(bigId(req.params.id), req.userId);
  if (!meeting || meeting.client !== ASSIST_CLIENT) throw new HttpError(404, 'Session not found');
  return meeting;
}

/** The 402 a session that already spent its goodwill answer gets. */
async function exhaustedError(userId) {
  const snap = await balanceSnapshot(await loadBalanceUser(userId));
  return quotaError({ balanceSeconds: snap.availableSeconds, trialUsed: snap.trialGranted });
}

/**
 * Which recogniser language a session listens in. 'auto' answers in the
 * interviewer's language, but a stream still has to be told what to expect:
 * Deepgram's multilingual model covers English and the European languages and
 * NOT Arabic, so an Arabic-speaking user on 'auto' listens in Arabic.
 */
function speechLanguageFor(language, uiLanguage) {
  if (language === 'ar' || language === 'en') return language;
  return uiLanguage === 'ar' ? 'ar' : 'multi';
}

/* ------------------------------------------------------------------ *
 * POST /api/assist/start
 * ------------------------------------------------------------------ */

const startSchema = z.object({
  jobId: z.string().regex(/^\d{1,19}$/).optional(),
  jobTitle: z.string().max(200).optional().default(''),
  company: z.string().max(200).optional().default(''),
  jobDescription: z.string().max(8000).optional().default(''),
  notes: z.string().max(3000).optional().default(''),
  language: z.enum(['auto', 'en', 'ar']).optional().default('auto'),
  uiLanguage: z.enum(['ar', 'en']).optional().default('en'),
  style: z.enum(STYLES).optional().default('balanced'),
  // The id this client already holds, if any — the only way to resume.
  // See startMeeting().
  resumeSessionId: z.union([z.string(), z.number()]).optional(),
});

router.post('/start', requireUser, aiLimiter, asyncHandler(async (req, res) => {
  const body = startSchema.parse(req.body ?? {});

  let job = null;
  if (body.jobId) {
    const found = await getJob(body.jobId);
    if (!found) throw new HttpError(404, 'Job not found', undefined, 'JOB_NOT_FOUND');
    job = { id: String(found.id), title: found.title || '', company: found.company || '', description: found.description || '' };
  } else if (body.jobTitle.trim() || body.jobDescription.trim()) {
    job = { id: null, title: body.jobTitle.trim(), company: body.company.trim(), description: body.jobDescription.trim() };
  }

  // The CV is optional. Without one the assistant still answers — just never
  // with a fact about the candidate, which the prompt already forbids.
  // A profile that cannot be read degrades to the same thing, rather than
  // refusing someone who is about to walk into an interview.
  let profile = null;
  try {
    profile = await loadProfile(req.userId);
  } catch (err) {
    logger.warn('assist: career profile unreadable', { message: err.message });
  }
  const hasCv = profileIsUsable(profile);
  const cv = hasCv ? cvToText(profile.cv).slice(0, 14000) : '';

  const { meeting, resumed, billing } = await startMeeting({
    userId: req.userId,
    categoryId: ASSIST_CATEGORY_ID,
    client: ASSIST_CLIENT,
    installId: installIdOf(req),
    resumeMeetingId: body.resumeSessionId ?? null,
  });

  const speechLanguage = speechLanguageFor(body.language, body.uiLanguage);
  const context = {
    kind: ASSIST_CLIENT,
    language: body.language,
    speechLanguage,
    style: body.style,
    job,
    cv,
    notes: body.notes.trim(),
  };
  // Written on every start, resumed or not: a resumed session may come back
  // with a different style or job, and the answer endpoint reads only this.
  await prisma.meetingSession.update({
    where: { id: meeting.id },
    data: { voiceContext: JSON.stringify(context) },
  });

  res.status(resumed ? 200 : 201).json({
    sessionId: meeting.id.toString(),
    resumed,
    billing,
    hasCv,
    job: job ? { id: job.id, title: job.title, company: job.company } : null,
    language: body.language,
    speechLanguage,
    style: body.style,
    // Whether the web client can stream to the server-side recogniser.
    streamingStt: sttConfigured(),
  });
}));

/* ------------------------------------------------------------------ *
 * POST /api/assist/:id/listen — speech-to-text credential
 * ------------------------------------------------------------------ */

router.post('/:id/listen', requireUser, aiLimiter, asyncHandler(async (req, res) => {
  const meeting = await assistSession(req);
  if (meeting.status !== 'live') throw meetingExpired();
  if (alreadyClosed(meeting)) throw await exhaustedError(req.userId);
  if (!sttConfigured()) {
    throw new HttpError(503, 'Live transcription is not configured', undefined, 'STT_UNAVAILABLE');
  }

  const context = parseContext(meeting.voiceContext) || {};
  const language = context.speechLanguage || 'multi';
  const params = new URLSearchParams({
    model: 'nova-3',
    language,
    smart_format: 'true',
    punctuate: 'true',
    interim_results: 'true',
    // Short endpointing is the latency: the answer cannot start before the
    // recogniser admits the question is over. UtteranceEnd is the backstop for
    // a noisy room where endpointing never fires.
    endpointing: '300',
    utterance_end_ms: '1000',
    vad_events: 'true',
  });
  // Names a generic model mishears: the company, the role. English streams
  // only — keyterm prompting is not offered for every language, and an
  // unsupported parameter fails the whole connection rather than the hint.
  if (language === 'en') {
    for (const term of [context.job?.title, context.job?.company]) {
      const t = String(term || '').trim().slice(0, 60);
      if (t.length > 1) params.append('keyterm', t);
    }
  }

  let grant;
  try {
    grant = await grantToken();
  } catch (err) {
    logger.error('assist stt grant failed', { message: err.message });
    throw new HttpError(503, 'Live transcription is unavailable right now', undefined, 'STT_UNAVAILABLE');
  }

  res.json({
    url: `${LISTEN_URL}?${params.toString()}`,
    token: grant.token,
    expiresIn: grant.expiresIn,
    language,
  });
}));

/* ------------------------------------------------------------------ *
 * POST /api/assist/:id/tick — the clock
 *
 * Running out is not an error here either: 200 with `billing.exhausted`, and
 * the client stops listening and offers a top-up.
 * ------------------------------------------------------------------ */

router.post('/:id/tick', requireUser, tickLimiter, asyncHandler(async (req, res) => {
  const meeting = await assistSession(req);
  const { billing } = await advanceMeeting(meeting.id, req.userId, { isTurn: false });
  res.json({ billing });
}));

/* ------------------------------------------------------------------ *
 * POST /api/assist/:id/answer — one suggested answer, streamed
 * ------------------------------------------------------------------ */

const answerSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  transcript: z.string().max(12000).optional().default(''),
  previous: z.array(z.string().max(4000)).max(4).optional().default([]),
  mode: z.enum(MODES).optional().default('answer'),
});

router.post('/:id/answer', requireUser, aiLimiter, asyncHandler(async (req, res) => {
  const body = answerSchema.parse(req.body ?? {});
  const meeting = await assistSession(req);
  if (alreadyClosed(meeting)) throw await exhaustedError(req.userId);
  if (meeting.status !== 'live') throw meetingExpired();

  const context = parseContext(meeting.voiceContext);
  if (!context) throw meetingExpired();

  // Meter it as a turn, exactly as /meeting/turn does: wall-clock plus the
  // floor, so answers cannot be issued in parallel for nothing. Throws 409 if
  // the session ended between the read above and here.
  const { billing } = await advanceMeeting(meeting.id, req.userId, { isTurn: true });

  // Headers before the first token — the candidate is waiting on this.
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  // `no-transform` makes compression() leave the stream alone.
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Passenger and LiteSpeed both honour this and stop buffering.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event, payload) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    res.flush?.();
  };

  // The client hanging up — the question went on, or they pressed stop — has
  // to reach the provider, or a dead answer keeps billing tokens.
  const abort = new AbortController();
  const onClose = () => { if (!res.writableEnded) abort.abort(); };
  res.on('close', onClose);

  let out = null;
  try {
    out = await streamAnswer({
      context,
      question: body.question,
      transcript: body.transcript,
      previous: body.previous,
      mode: body.mode,
      userId: req.userId,
      signal: abort.signal,
      send,
    });
  } catch (err) {
    // Nothing was said: this answer costs the user nothing beyond the
    // wall-clock that genuinely passed. Same rule as /meeting/turn.
    await reverseTurnFloor(meeting.id, req.userId, billing.floorTopUp);
    if (!(err instanceof AiUnavailableError)) {
      logger.error('assist answer failed', { message: err.message });
    }
    send('error', {
      code: 'AI_UNAVAILABLE',
      message: 'The assistant is temporarily unavailable. You were not charged for this answer.',
    });
    res.end();
    return;
  } finally {
    res.off('close', onClose);
  }

  // Hung up before a single word arrived: nothing was delivered, so the floor
  // goes back too. Words that DID arrive were paid for at the provider.
  if (out?.aborted && !out.text?.trim()) {
    await reverseTurnFloor(meeting.id, req.userId, billing.floorTopUp);
  }

  // The goodwill answer has been served; close the session so the next one is
  // refused rather than swept back to life. See /meeting/turn.
  if (billing.exhausted) {
    try {
      await endMeeting(meeting.id, req.userId, { reason: 'exhausted' });
    } catch (err) {
      logger.error('closing an exhausted assist session failed', {
        meetingId: String(meeting.id), message: err.message,
      });
    }
  }

  send('done', { billing, partial: Boolean(out?.partial) });
  res.end();
}));

/* ------------------------------------------------------------------ *
 * POST /api/assist/:id/end
 * ------------------------------------------------------------------ */

router.post('/:id/end', requireUser, asyncHandler(async (req, res) => {
  const meeting = await assistSession(req);
  const out = await endMeeting(meeting.id, req.userId, { reason: 'user_ended' });
  if (!out) throw new HttpError(404, 'Session not found');
  // The CV and the notes are not kept past the session that needed them.
  await prisma.meetingSession.update({ where: { id: meeting.id }, data: { voiceContext: null } })
    .catch((err) => logger.warn('clearing assist context failed', { message: err.message }));
  res.json({
    billing: out.billing,
    billedSeconds: out.meeting.billedSeconds,
    skippedSeconds: out.meeting.skippedSeconds,
  });
}));

export default router;
