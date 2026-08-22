/**
 * Live mock interview ("meeting") — the flagship feature, and the thing the
 * minute balance is actually spent on.
 *
 * METERING, as of the move from daily questions to minutes:
 *
 *   /start          opens the billing clock, places a reservation, resolves the
 *                   free trial. Refuses below one minute — an interview that
 *                   dies in eight seconds is worse than one that never opened.
 *   /:id/tick       the clock. Cheap, no AI, every 15 seconds. Charges only the
 *                   wall-clock it has evidence for.
 *   /turn           accrues like a tick, plus a floor so a client that stops
 *                   ticking cannot interview for free.
 *   /prepare        flat charge for the CV analysis, free for subscribers.
 *   /finish         FREE, never blocked by a balance — once per billed meeting.
 *
 * That last line is the one to read twice. The evaluation is the deliverable
 * the minutes were spent ON; gating it behind a balance the interview itself
 * just consumed would charge twice for one interview and withhold the thing
 * they paid for. It runs for abandoned meetings too, so a user whose app was
 * killed still gets the evaluation for the part they were charged for.
 *
 * "Free" is not the same as "unbounded", and it used to be implemented as the
 * second: /finish checked nothing at all, including whether the caller had ever
 * been billed for an interview, so a fabricated two-message `history` from a
 * fresh account ran the evaluator. It is now one evaluation per meeting that
 * actually accrued time — which every honest user has, and which costs them
 * nothing.
 */

import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';

import { logger } from '../utils/logger.js';
import { requireUser } from '../middleware/auth.js';
import { aiLimiter, heavyAiLimiter, tickLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { prisma } from '../db/prisma.js';
import { meetingTurn, evaluateInterview, summarizeCv, AiUnavailableError } from '../services/ai/index.js';
import {
  CFG, hasPremium, chargeFlat, refundFlat, loadBalanceUser, balanceSnapshot,
} from '../services/billing/minutes.js';
import {
  startMeeting, advanceMeeting, endMeeting, resolveTurnMeeting, reverseTurnFloor,
  latestMeetingFor, readMeeting, alreadyClosed, meetingExpired,
} from '../services/billing/meetings.js';
import { notifyEvaluationReady } from '../services/push/notify.js';

const router = Router();

const MAX_TURNS = 40;
const TARGET_ASSISTANT_TURNS = 7;

// pdf-parse is loaded lazily: its module-level debug branch probes for a test
// fixture that does not exist in a production install and throws at import.
async function parsePdf(buffer) {
  const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
  return pdfParse(buffer);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  // The old config accepted ANY file type and fed the bytes straight to an
  // unmaintained PDF parser.
  fileFilter(_req, file, cb) {
    const ok = file.mimetype === 'application/pdf'
      || file.mimetype === 'text/plain'
      || /\.(pdf|txt|md)$/i.test(file.originalname);
    cb(null, ok);
  },
});

/* ------------------------------------------------------------------ *
 * Shared guards
 * ------------------------------------------------------------------ */

async function loadCategoryFor(req, categoryId) {
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category || !category.isActive) throw new HttpError(404, 'Category not found');

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new HttpError(404, 'User not found');
  if (user.isDisabled) throw new HttpError(403, 'هذا الحساب موقوف / This account is suspended');

  // PREMIUM_REQUIRED keeps its exact meaning: premium-only CATEGORIES. Minutes
  // and premium are orthogonal — a pack buyer has minutes but no premium and
  // must still be refused here. Never conflate the two codes.
  if (category.isPremium && !hasPremium(user)) {
    throw new HttpError(402, 'Premium subscription required', undefined, 'PREMIUM_REQUIRED');
  }
  return { category, user };
}

/** The install id used to claim the free trial. Absent on old clients. */
const installIdOf = (req) => req.get('x-install-id') || null;

const bigMeetingId = (raw) => {
  try { return BigInt(raw); } catch { throw new HttpError(400, 'Invalid meeting id'); }
};

const contextSchema = z.object({
  categoryId: z.coerce.number().int().positive().optional(),
  company: z.string().max(200).nullable().optional(),
  jobTitle: z.string().max(200).nullable().optional(),
  jobDescription: z.string().max(6000).nullable().optional(),
  cvSummary: z.string().max(4000).nullable().optional(),
  cvKey: z.any().optional(),
  gender: z.enum(['male', 'female']).optional(),
}).nullable().optional();

/* ------------------------------------------------------------------ *
 * POST /api/meeting/start — open the billing clock
 * ------------------------------------------------------------------ */

const startSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  client: z.string().max(32).optional(),
  // The id THIS client was already given, if it has one. Presenting it is the
  // only way to resume: see startMeeting(). A client that presents nothing is
  // asking for a new interview, and any other live meeting on the account is a
  // second concurrent one and gets settled and closed.
  resumeMeetingId: z.union([z.string(), z.number()]).optional(),
});

router.post('/start', requireUser, asyncHandler(async (req, res) => {
  const body = startSchema.parse(req.body ?? {});
  await loadCategoryFor(req, body.categoryId);

  const { meeting, resumed, billing } = await startMeeting({
    userId: req.userId,
    categoryId: body.categoryId,
    client: body.client,
    installId: installIdOf(req),
    resumeMeetingId: body.resumeMeetingId ?? null,
  });

  res.status(resumed ? 200 : 201).json({
    meetingId: meeting.id.toString(),
    resumed,
    startedAt: meeting.startedAt,
    billing,
  });
}));

/* ------------------------------------------------------------------ *
 * POST /api/meeting/:meetingId/tick — the clock
 *
 * No body, no AI, cheap. Running out is NEVER an error here: the response is
 * 200 with `billing.exhausted`, and the interview ends through the ordinary
 * wrap-up path on the next turn. A 402 in the middle of someone speaking is a
 * dead line, not a paywall.
 * ------------------------------------------------------------------ */

router.post('/:meetingId/tick', requireUser, tickLimiter, asyncHandler(async (req, res) => {
  const meetingId = bigMeetingId(req.params.meetingId);
  const { billing } = await advanceMeeting(meetingId, req.userId, { isTurn: false });
  res.json({ billing });
}));

/* ------------------------------------------------------------------ *
 * POST /api/meeting/:meetingId/end — user closed the interview
 * ------------------------------------------------------------------ */

router.post('/:meetingId/end', requireUser, asyncHandler(async (req, res) => {
  const meetingId = bigMeetingId(req.params.meetingId);
  const out = await endMeeting(meetingId, req.userId, { reason: 'user_ended' });
  if (!out) throw new HttpError(404, 'Meeting not found');
  res.json({
    billing: out.billing,
    billedSeconds: out.meeting.billedSeconds,
    skippedSeconds: out.meeting.skippedSeconds,
  });
}));

/* ------------------------------------------------------------------ *
 * POST /api/meeting/prepare — CV + job context
 * ------------------------------------------------------------------ */

router.post('/prepare', requireUser, heavyAiLimiter, upload.single('cv'), asyncHandler(async (req, res) => {
  const schema = z.object({
    categoryId: z.coerce.number().int().positive(),
    company: z.string().max(200).optional().default(''),
    jobTitle: z.string().max(200).optional().default(''),
    jobDescription: z.string().max(6000).optional().default(''),
    language: z.enum(['ar', 'en']).optional().default('ar'),
    gender: z.enum(['male', 'female']).optional().default('female'),
  });
  const body = schema.parse(req.body);
  await loadCategoryFor(req, body.categoryId);

  let cvText = '';
  let cvError = null;

  if (req.file) {
    try {
      if (req.file.mimetype === 'application/pdf' || /\.pdf$/i.test(req.file.originalname)) {
        const parsed = await parsePdf(req.file.buffer);
        cvText = (parsed?.text || '').trim();
      } else {
        cvText = req.file.buffer.toString('utf-8').trim();
      }
    } catch (err) {
      logger.warn('CV parse failed', { message: err.message });
      cvError = 'تعذّر قراءة السيرة الذاتية. جرّب رفع نسخة PDF نصية (وليست صورة ممسوحة ضوئيًا).';
    }
    if (!cvText && !cvError) {
      cvError = 'الملف لا يحتوي على نص قابل للقراءة. إذا كانت سيرتك صورة ممسوحة، صدّرها كـ PDF نصي.';
    }
  }

  let cvSummary = null;
  let cvKey = null;

  if (cvText) {
    // CV analysis is the most expensive single call in the product, so it is a
    // flat charge rather than free. Subscribers pay nothing — chargeFlat()
    // exempts them — and the flat fee is listed on the pricing screen, because
    // a hidden minimum is the thing users forgive least.
    const receipt = await chargeFlat({
      userId: req.userId,
      seconds: CFG.cvPrepare(),
      note: 'cv_analysis',
    });
    try {
      const out = await summarizeCv({ cvText, language: body.language, userId: req.userId });
      cvSummary = out.cvSummary;
      cvKey = out.cvKey;
    } catch (err) {
      // A failed model call costs the user nothing. Same discipline as before.
      await refundFlat(receipt, 'cv_analysis_failed');
      if (err instanceof AiUnavailableError) {
        logger.error('CV summarise failed', { message: err.message });
        cvError = 'تعذّر تحليل السيرة الذاتية حاليًا. يمكنك متابعة المقابلة بدونها.';
      } else throw err;
    }
  }

  res.json({
    context: {
      categoryId: body.categoryId,
      company: body.company.trim() || null,
      jobTitle: body.jobTitle.trim() || null,
      jobDescription: body.jobDescription.trim() || null,
      gender: body.gender,
      cvSummary,
      cvKey,
    },
    cvError,
    cvHasText: Boolean(cvText),
  });
}));

/* ------------------------------------------------------------------ *
 * POST /api/meeting/turn
 * ------------------------------------------------------------------ */

const turnSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  // Optional on purpose. Old clients — the installed Play build and the cached
  // /app bundle — do not send it, and neither does an interview that was
  // already running when this backend went live.
  meetingId: z.union([z.string(), z.number()]).optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(3000),
  })).default([]),
  userMessage: z.string().max(3000).optional().default(''),
  language: z.enum(['ar', 'en']).optional().default('ar'),
  context: contextSchema,
});

router.post('/turn', requireUser, aiLimiter, asyncHandler(async (req, res) => {
  const body = turnSchema.parse(req.body);
  const { category } = await loadCategoryFor(req, body.categoryId);

  // The old schema hard-rejected a history longer than 20 with a 400, which
  // killed the interview mid-conversation. Keep the opening turn (it anchors
  // the persona and company) plus the most recent exchanges, and drop the
  // middle — the model keeps its bearings and the request stays bounded.
  let history = body.history;
  if (history.length > MAX_TURNS) {
    history = [history[0], ...history.slice(-(MAX_TURNS - 1))];
  }

  // No meeting id is the legacy path. It resolves to the user's own live
  // meeting when there is one — so a modern client that drops the field is
  // metered exactly as if it had not — and otherwise opens a real, balance-
  // checked meeting. It is NOT a way to get an unmetered one.
  const meetingId = body.meetingId
    ? bigMeetingId(body.meetingId)
    : await resolveTurnMeeting({
        userId: req.userId,
        categoryId: body.categoryId,
        installId: installIdOf(req),
      });

  // A meeting that already served its goodwill closing turn is done. This is
  // the only place /turn returns 402: the client had its wrap-up.
  const current = await readMeeting(meetingId, req.userId);
  if (!current) throw meetingExpired();
  if (alreadyClosed(current)) {
    const user = await loadBalanceUser(req.userId);
    const snap = await balanceSnapshot(user);
    throw new HttpError(
      402,
      'لم يتبقَّ رصيد من دقائق المقابلات / You have run out of interview minutes',
      { reason: 'insufficient_minutes', balanceSeconds: snap.availableSeconds, trialUsed: snap.trialGranted },
      'QUOTA_EXCEEDED',
    );
  }

  // The opening turn is free — nobody should pay for "hello".
  //
  // What "opening" means has to be decided from the meeting row, not from the
  // request. `history` and `userMessage` are supplied by the client, so the
  // original test — an empty history and no message — was a free-model switch
  // any caller could flip: post `{history: [], userMessage: ''}` on a loop and
  // every turn bills as an opening while the interviewer keeps answering. The
  // model was still called each time, and paid for.
  //
  // `turn_count` is the server's own count, incremented under the meeting's row
  // lock on every billed turn, and it is the same field /finish already trusts.
  // The client's shape is kept in the test as well: an opening with a question
  // in it is not an opening, however new the meeting is.
  const isOpening = current.turnCount === 0 && history.length === 0 && !body.userMessage;

  const { billing } = await advanceMeeting(meetingId, req.userId, { isTurn: !isOpening });

  const assistantTurns = history.filter((h) => h.role === 'assistant').length;

  try {
    const out = await meetingTurn({
      history,
      userMessage: body.userMessage,
      language: body.language,
      gender: body.context?.gender || 'female',
      context: body.context
        ? { ...body.context, jobTitle: body.context.jobTitle || (body.language === 'ar' ? category.nameAr : category.nameEn) }
        : null,
      userId: req.userId,
      // Exhaustion reuses the machinery that already exists. The interviewer
      // says "شكرًا لوقتك، دي كانت آخر سؤال" and the call CONCLUDES; the client
      // already handles status === 'closing'. The user is never cut off, and
      // there is no new state machine to get wrong.
      shouldClose: assistantTurns >= TARGET_ASSISTANT_TURNS || billing.exhausted,
    });

    // The goodwill closing turn has now been served, so CLOSE THE MEETING here
    // rather than leaving a flag on a live row for the next request to respect.
    //
    // The flag alone did not hold: `end_reason = 'exhausted'` was re-stamped to
    // 'abandoned' by the every-minute sweep as soon as the heartbeat went
    // stale, and the next /turn then opened a fresh meeting and served another
    // goodwill turn — an unlimited interview at a zero balance, one exchange
    // every two minutes, with the client supplying the history so the
    // conversation never even noticed. A terminal status cannot be swept back
    // into a live one, and the balance gate in startMeeting() refuses to open
    // the replacement.
    if (billing.exhausted) {
      try {
        await endMeeting(meetingId, req.userId, { reason: 'exhausted' });
      } catch (err) {
        logger.error('closing an exhausted meeting failed', {
          meetingId: String(meetingId), message: err.message,
        });
      }
    }

    res.json({
      reply: out.reply,
      status: out.status,
      note: out.note,
      tips: out.tips,
      tokensUsed: out.tokensUsed,
      turnIndex: history.length + (body.userMessage ? 1 : 0),
      meetingId: meetingId.toString(),
      billing,
    });
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      // Reverse this turn's floor top-up: a model call that failed is not
      // interview time. The wall-clock already ticked is left charged — that
      // time genuinely passed with the user waiting in the interview.
      await reverseTurnFloor(meetingId, req.userId, billing.floorTopUp);
      logger.error('Meeting turn failed', { message: err.message });
      throw new HttpError(503, 'The interviewer is temporarily unavailable', undefined, 'AI_UNAVAILABLE');
    }
    throw err;
  }
}));

/* ------------------------------------------------------------------ *
 * POST /api/meeting/finish — the evaluation. Always free, once per interview.
 * ------------------------------------------------------------------ */

const finishSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  meetingId: z.union([z.string(), z.number()]).optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(3000),
  })).min(2),
  language: z.enum(['ar', 'en']).optional().default('ar'),
  context: contextSchema,
});

router.post('/finish', requireUser, aiLimiter, asyncHandler(async (req, res) => {
  const body = finishSchema.parse(req.body);
  await loadCategoryFor(req, body.categoryId);

  // STILL NO BALANCE CHECK, and there must never be one: the evaluation is the
  // deliverable the minutes bought, and charging for it would charge twice for
  // one interview. What there IS now is a check that an interview HAPPENED.
  //
  // "Free and unconditional" was implemented as "never check anything" — not
  // even whether a meeting existed. `latestMeetingFor()` returning null meant
  // no billing ran and evaluateInterview(), the second most expensive call in
  // the product, was invoked anyway on a two-element `history` the client made
  // up. Registration is unverified and authLimiter skips successful requests,
  // so that was unbounded model spend from an unbounded number of accounts, all
  // with a zero balance.
  //
  // The bound is one evaluation per BILLED meeting. Every honest user has one
  // — the interview they just paid for with their minutes — and it costs them
  // nothing.
  const meetingId = body.meetingId
    ? bigMeetingId(body.meetingId)
    : await latestMeetingFor(req.userId);

  // `turnCount` as well as `billedSeconds`, so a subscriber — who is exempt
  // from the turn floor and is billed pure wall-clock — cannot be refused their
  // evaluation for an interview the meter happened to round to zero seconds.
  const meeting = meetingId ? await readMeeting(meetingId, req.userId) : null;
  if (!meeting || (meeting.billedSeconds <= 0 && meeting.turnCount <= 0)) {
    throw new HttpError(
      409,
      'لا توجد مقابلة لتقييمها / There is no interview to evaluate',
      { reason: 'no_billed_interview' },
      'NO_INTERVIEW',
    );
  }

  // Claim the meeting in ONE conditional UPDATE, before the model call: the
  // WHERE clause is the check, so two concurrent /finish calls cannot both pass
  // it. Without this, aiLimiter's 20/min was the only cap on re-evaluating the
  // same 30-second interview.
  const previousReason = meeting.endReason ?? null;
  const claimed = await prisma.$executeRaw`
    UPDATE meeting_sessions
       SET end_reason = 'evaluated'
     WHERE id = ${meeting.id}
       AND user_id = ${req.userId}
       AND session_id IS NULL
       AND (end_reason IS NULL OR end_reason <> 'evaluated')
  `;
  if (claimed === 0) {
    // The evaluation is not lost — it was persisted as a session the moment it
    // was generated, and it is in History. Say so, and hand back the id.
    throw new HttpError(
      409,
      'تم تقييم هذه المقابلة بالفعل، وتجدها في سجلّ جلساتك / This interview has already been evaluated — it is in your session history',
      { sessionId: meeting.sessionId ? meeting.sessionId.toString() : null },
      'ALREADY_EVALUATED',
    );
  }

  /** Hand the meeting back if the evaluation never happened. */
  const releaseClaim = async () => {
    try {
      await prisma.$executeRaw`
        UPDATE meeting_sessions SET end_reason = ${previousReason}
         WHERE id = ${meeting.id} AND session_id IS NULL AND end_reason = 'evaluated'
      `;
    } catch (err) {
      logger.error('releasing the evaluation claim failed', {
        meetingId: String(meeting.id), message: err.message,
      });
    }
  };

  let settled = null;
  try {
    settled = await endMeeting(meetingId, req.userId, { reason: 'evaluated' });
  } catch (err) {
    // Billing must never be the reason a user cannot see their evaluation.
    logger.error('meeting settle at finish failed', {
      meetingId: String(meetingId), message: err.message,
    });
  }

  let evaluation;
  try {
    const out = await evaluateInterview({
      history: body.history,
      language: body.language,
      context: body.context || null,
      userId: req.userId,
    });
    evaluation = out.evaluation;

    // Persist as a session so it appears in History and Stats.
    const answered = body.history.filter((h) => h.role === 'user');
    const overall = Math.max(0, Math.min(10, Math.round(Number(evaluation.overall_score) || 0)));
    const billedSeconds = settled?.meeting?.billedSeconds ?? 0;

    const session = await prisma.$transaction(async (tx) => {
      const created = await tx.session.create({
        data: {
          userId: req.userId,
          categoryId: body.categoryId,
          kind: 'meeting',
          totalScore: overall * answered.length,
          answerCount: answered.length,
          billedSeconds,
          // The REAL start, from the billing clock. The old code fabricated
          // `Date.now() - history.length * 60_000`, so every interview in
          // History claimed a duration nobody had measured.
          startedAt: settled?.meeting?.startedAt ?? new Date(),
          endedAt: new Date(),
        },
      });

      // Pair each candidate reply with the question that preceded it.
      const rows = [];
      let lastQuestion = null;
      let i = 0;
      for (const turn of body.history) {
        if (turn.role === 'assistant') { lastQuestion = turn.content; continue; }
        const perQ = evaluation.per_question?.[i];
        rows.push({
          sessionId: created.id,
          // NULL rather than a fabricated FK to question #1.
          questionId: null,
          questionText: lastQuestion,
          userAnswer: turn.content,
          aiScore: Math.max(0, Math.min(10, Math.round(Number(perQ?.score ?? overall) || 0))),
          aiFeedback: JSON.stringify({
            meeting: true,
            comment: perQ?.comment ?? evaluation.summary,
          }),
          tokensUsed: 0,
        });
        i += 1;
      }
      if (rows.length) await tx.answer.createMany({ data: rows });
      return created;
    });

    // Unconditionally, not only when the settlement succeeded: `session_id` is
    // half of the claim that stops this meeting being evaluated a second time,
    // and a failed settlement is exactly when it must still hold.
    await prisma.$executeRaw`
      UPDATE meeting_sessions SET session_id = ${session.id} WHERE id = ${meeting.id}
    `;

    // "Your evaluation is ready" — the one notification users are actually
    // waiting for, because evaluating a thirty-minute interview takes long
    // enough that they leave the app.
    //
    // AFTER THE COMMIT, NEVER INSIDE IT. The session and its answers are
    // already durable; a push that failed inside that transaction would roll
    // back the evaluation the user just spent an interview's worth of minutes
    // on. Not awaited either, so a slow FCM token exchange cannot hold the
    // response open — the payload below is what the app renders right now, and
    // the push is only for the copy that is no longer in the foreground.
    //
    // EXACTLY ONE PER MEETING, and not because of anything written here: the
    // conditional claim above (`session_id IS NULL AND end_reason <> 'evaluated'`)
    // is the sole route to this line, so a retried /finish is refused with 409
    // ALREADY_EVALUATED before the evaluator is even called.
    //
    // `overall` is the evaluator's 0-10 scale; notifyEvaluationReady() renders
    // "من 100". Passing it unscaled would tell someone who interviewed
    // excellently that they scored 8 out of 100.
    notifyEvaluationReady(req.userId, { sessionId: session.id, score: overall * 10 })
      .catch((err) => logger.warn('evaluation-ready notification failed', {
        sessionId: session.id.toString(), message: err.message,
      }));

    res.json({
      evaluation,
      tokensUsed: out.tokensUsed,
      sessionId: session.id.toString(),
      // The receipt. `skippedSeconds` is the trust argument made visible: it
      // tells the user, on their own receipt, that the meter stopped when the
      // interview did.
      billing: settled
        ? {
            billedSeconds: settled.meeting.billedSeconds,
            skippedSeconds: settled.meeting.skippedSeconds,
            remainingSeconds: settled.billing.remainingSeconds,
            remainingMinutes: settled.billing.remainingMinutes,
          }
        : null,
    });
  } catch (err) {
    // The evaluation did not happen, so the claim on it must not stand: a user
    // whose model call 529'd has to be able to press the button again.
    await releaseClaim();
    if (err instanceof AiUnavailableError) {
      logger.error('Interview evaluation failed', { message: err.message });
      throw new HttpError(503, 'Could not generate the final evaluation', undefined, 'AI_UNAVAILABLE');
    }
    throw err;
  }
}));

export default router;
