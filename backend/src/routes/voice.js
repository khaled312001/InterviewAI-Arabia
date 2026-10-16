/**
 * Live voice interview — session credentials and the model endpoint.
 *
 * Three endpoints with opposite callers, which is the thing to hold on to while
 * reading this file:
 *
 *   POST /session   Called by OUR client, authenticated as the user. Hands
 *                   back a short-lived Deepgram token and the settings for the
 *                   call, and parks the interview context where the other
 *                   endpoints can find it.
 *   POST /think     Called by DEEPGRAM, from the public internet, once per
 *                   turn of the conversation. Authenticated by the bearer
 *                   token minted above and nothing else — there is no user
 *                   session on that request and there cannot be.
 *   POST /speak     Also called by DEEPGRAM, for Arabic only, once per sentence
 *                   the interviewer says. Same token, same reason: Deepgram has
 *                   no Arabic voice, so the agent's voice is ours.
 *
 * BILLING IS UNCHANGED AND STAYS WHERE IT IS. The minute clock is still
 * /meeting/start, /meeting/tick and /meeting/end, and the voice client ticks
 * exactly like the typed one. This file deliberately takes no money: a meeting
 * that is not live cannot open a voice session at all, so the only way to talk
 * to the interviewer is through a clock that is already running.
 */

import { Router } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';
import { cfg } from '../services/secrets/store.js';
import { logger } from '../utils/logger.js';
import { requireUser } from '../middleware/auth.js';
import { aiLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { prisma } from '../db/prisma.js';
import { readMeeting, alreadyClosed, advanceMeeting } from '../services/billing/meetings.js';
import { MARKET_CODES } from '../services/ai/markets.js';
import { isConfigured, canSpeak, grantToken, settingsFor } from '../services/voice/agent.js';
import { streamTurn } from '../services/voice/think.js';
import { streamSpeech, MAX_INPUT_CHARS } from '../services/voice/speak.js';
import { prewarm as prewarmVoice } from '../services/tts/edgeNeural.js';

const router = Router();

/** Deepgram's own address. Here rather than in the client, so it is one edit. */
const AGENT_URL = 'wss://agent.deepgram.com/v1/agent/converse';

/**
 * How long the think-endpoint token stays valid.
 *
 * It is the ceiling on one interview, not on one request: Deepgram presents it
 * on every turn for as long as the websocket is open. Two hours is far longer
 * than any interview the minute balance can pay for, and the token is useless
 * on its own — it names a meeting, and a meeting that has ended refuses the
 * turn regardless of how valid the signature is.
 */
const THINK_TOKEN_TTL = '2h';

const contextSchema = z.object({
  categoryId: z.coerce.number().int().positive().optional(),
  company: z.string().max(200).nullable().optional(),
  jobTitle: z.string().max(200).nullable().optional(),
  jobDescription: z.string().max(6000).nullable().optional(),
  cvSummary: z.string().max(4000).nullable().optional(),
  gender: z.enum(['male', 'female']).optional(),
  // Interpolated into a system prompt, so it is validated against the table
  // rather than accepted as free text — same boundary as the typed interview.
  market: z.enum(MARKET_CODES).nullable().optional(),
}).nullable().optional();

const sessionSchema = z.object({
  meetingId: z.union([z.string(), z.number()]),
  language: z.enum(['ar', 'en']).default('ar'),
  gender: z.enum(['male', 'female']).default('female'),
  context: contextSchema,
});

/* ------------------------------------------------------------------ *
 * POST /api/voice/session — credentials for one call
 * ------------------------------------------------------------------ */

router.post('/session', requireUser, aiLimiter, asyncHandler(async (req, res) => {
  const body = sessionSchema.parse(req.body ?? {});

  if (!isConfigured()) {
    throw new HttpError(503, 'Voice interviews are not configured', undefined, 'VOICE_UNAVAILABLE');
  }

  /*
   * Arabic has no Deepgram voice and uses ours. Refusing here, before a single
   * frame of audio is sent, is the whole point: the failure this prevents is a
   * call that connects, listens, understands, and then says nothing — which is
   * indistinguishable from a broken microphone to the person on the other end.
   * The client's answer to this 503 is the typed interview, which always works.
   */
  if (!await canSpeak(body.language)) {
    throw new HttpError(
      503,
      body.language === 'ar'
        ? 'The Arabic interview voice is unavailable right now'
        : 'Voice interviews are not configured',
      undefined,
      'VOICE_NO_VOICE',
    );
  }

  let meetingId;
  try {
    meetingId = BigInt(body.meetingId);
  } catch {
    throw new HttpError(400, 'Invalid meetingId');
  }

  const meeting = await readMeeting(meetingId, req.userId);
  if (!meeting) throw new HttpError(404, 'Meeting not found');
  if (alreadyClosed(meeting)) throw new HttpError(409, 'Meeting already ended', undefined, 'MEETING_CLOSED');

  // The context is written here and read by /think. Storing it is what stops
  // the interviewer's instructions from being client-supplied on a request
  // that arrives from the public internet.
  const context = body.context ?? null;
  await prisma.meetingSession.update({
    where: { id: meetingId },
    data: { voiceContext: context ? JSON.stringify(context) : null },
  });

  const thinkToken = jwt.sign(
    {
      sub: req.userId.toString(),
      type: 'voice',
      mid: meetingId.toString(),
      lang: body.language,
      gender: body.gender,
    },
    env.JWT_SECRET,
    { expiresIn: THINK_TOKEN_TTL },
  );

  const { token, expiresIn } = await grantToken();

  /*
   * Open the voice connection now, while the client is still negotiating with
   * Deepgram and asking the browser for a microphone. The handshake to the
   * voice service costs about half a second and the greeting is the first
   * thing the candidate hears — paying for it here means paying for it during
   * time that was already being spent. Not awaited: nothing depends on it, and
   * a failure here must not fail the session.
   */
  if (body.language === 'ar') prewarmVoice();

  // APP_URL and not the request's own host: the address has to be the one
  // Deepgram can reach from outside, which behind a proxy is not what
  // req.headers.host says it is.
  const origin = String(cfg('APP_URL') || env.APP_URL).replace(/\/+$/, '');
  const thinkUrl = `${origin}/api/voice/think`;
  const speakUrl = `${origin}/api/voice/speak`;

  logger.info('voice session opened', {
    userId: String(req.userId), meetingId: String(meetingId), language: body.language,
  });

  res.json({
    url: AGENT_URL,
    token,
    expiresIn,
    settings: settingsFor({
      language: body.language,
      gender: body.gender,
      context,
      thinkUrl,
      thinkToken,
      speakUrl,
      // The same token for both endpoints: they carry the same authority over
      // the same meeting for the same two hours, and a second one would be a
      // second thing to get wrong rather than a second boundary.
      speakToken: thinkToken,
    }),
  });
}));

/* ------------------------------------------------------------------ *
 * POST /api/voice/think — one turn of the interview
 * ------------------------------------------------------------------ */

/**
 * Authenticate the caller as Deepgram-on-behalf-of-a-meeting.
 *
 * `requireUser` cannot be used: this request has no user session, no cookie
 * and no refresh token — it comes from Deepgram's infrastructure, carrying
 * only the bearer token /session minted. So the token IS the authorisation,
 * and it is deliberately narrow: one type, one meeting, two hours.
 */
function voiceSession(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) throw new HttpError(401, 'Authentication required');

  let payload;
  try {
    payload = jwt.verify(header.slice(7), env.JWT_SECRET);
  } catch {
    throw new HttpError(401, 'Invalid or expired voice token');
  }
  if (payload.type !== 'voice') throw new HttpError(401, 'Invalid token type');

  return {
    userId: BigInt(payload.sub),
    meetingId: BigInt(payload.mid),
    language: payload.lang === 'en' ? 'en' : 'ar',
    gender: payload.gender === 'male' ? 'male' : 'female',
  };
}

router.post('/think', asyncHandler(async (req, res) => {
  const session = voiceSession(req);

  const meeting = await readMeeting(session.meetingId, session.userId);
  if (!meeting) throw new HttpError(404, 'Meeting not found');

  /*
   * A meeting that has ended stops thinking, even though the websocket may
   * still be open and the token still valid. Without this, hanging on to a
   * connection past /end would buy an unmetered interview: the minute clock
   * is settled, and every further turn is a free model call.
   */
  if (alreadyClosed(meeting)) throw new HttpError(409, 'Meeting already ended', undefined, 'MEETING_CLOSED');

  let context = null;
  if (meeting.voiceContext) {
    try {
      context = JSON.parse(meeting.voiceContext);
    } catch (err) {
      // Not fatal: an interview with no context is a generic interview, which
      // is a far better outcome than a silent one.
      logger.warn('voice context unreadable', { meetingId: String(session.meetingId), message: err.message });
    }
  }

  /*
   * METER THE TURN, exactly as /meeting/turn does.
   *
   * Leaving this out looked defensible — the minute clock is /meeting/tick and
   * the voice client ticks like any other — right up to the point where you
   * ask what a client that simply STOPS ticking gets. In the typed interview
   * the answer is "nothing": /turn accrues wall-clock and applies a floor, so
   * a silent clock still bills per exchange. Without the same call here, a
   * voice client that stops ticking keeps talking to the interviewer for free
   * for as long as it likes, and the only thing standing between that and an
   * unmetered product is the client's own good manners.
   *
   * It throws if the meeting is no longer live, which is the same answer the
   * check above gives and for the same reason.
   */
  const { billing } = await advanceMeeting(session.meetingId, session.userId, { isTurn: true });

  await streamTurn({
    session: { ...session, context },
    body: req.body ?? {},
    res,
    // Out of minutes closes the interview the graceful way the typed flow
    // already uses: the interviewer thanks the candidate and wraps up, rather
    // than the call going dead mid-sentence.
    shouldClose: Boolean(billing?.exhausted),
  });
}));

/* ------------------------------------------------------------------ *
 * POST /api/voice/speak — the Arabic voice
 * ------------------------------------------------------------------ */

/**
 * Deepgram's text-to-speech provider, which is us.
 *
 * Called once per sentence of the interviewer's speech, from the public
 * internet, authenticated by the same voice token as /think. The request shape
 * is OpenAI's audio API because that is the costume Deepgram's `open_ai`
 * provider wears; `model`, `voice` and `response_format` arrive on every call
 * and are ignored, because the Settings frame travels through the client and
 * the only trustworthy source for which voice speaks is the signed token.
 *
 * Deliberately NOT metered and deliberately not checked against the meeting's
 * state. Synthesis costs nothing, and the turn that produced this text was
 * already metered and already refused if the meeting had ended — adding a
 * database read here would put one in front of every sentence the interviewer
 * says, which is latency the candidate hears. Nor is there a rate limiter:
 * every request on this endpoint comes from Deepgram's own addresses, so a
 * per-IP limit would throttle a long interview rather than an abuser. What a
 * stolen token buys is a free text-to-speech proxy for two hours, bounded by
 * the length cap, and that is the trade being made.
 */
const speakSchema = z.object({
  input: z.string().min(1).max(MAX_INPUT_CHARS),
}).passthrough();

router.post('/speak', asyncHandler(async (req, res) => {
  const session = voiceSession(req);
  const { input } = speakSchema.parse(req.body ?? {});

  try {
    const { seconds } = await streamSpeech({
      text: input,
      gender: session.gender,
      language: session.language,
      res,
    });
    logger.debug('voice spoke', { meetingId: String(session.meetingId), seconds: seconds.toFixed(2) });
  } catch (err) {
    // Past the first byte there is nothing to say: the error handler drops the
    // socket and Deepgram reports the utterance as failed, which the client
    // already treats as a failed call.
    if (res.headersSent) throw err;
    logger.error('voice synthesis failed', {
      meetingId: String(session.meetingId), message: err.message,
    });
    throw new HttpError(502, 'Voice synthesis failed', undefined, 'VOICE_SYNTH_FAILED');
  }
}));

export default router;
