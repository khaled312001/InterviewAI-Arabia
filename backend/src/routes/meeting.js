import { Router } from 'express';
import { z } from 'zod';

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { requireUser } from '../middleware/auth.js';
import { aiLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { queryOne, query } from '../db/mysql.js';
import { prisma } from '../db/prisma.js';

const router = Router();

// -------------------------------------------------------------------------
// Conversational interview — "Sarah", an HR persona that runs a short mock
// interview via voice (STT/TTS happens client-side on web). The backend
// orchestrates the conversation using Groq Llama 3.3 70B, keeping replies
// short because they're spoken aloud.
// -------------------------------------------------------------------------

const MAX_TURNS = 16;   // hard cap on assistant+user messages (safety)
const TARGET_TURNS = 14; // after this many turns we ask Sarah to wrap up

function systemPrompt({ categoryName, userName, language = 'ar' }) {
  if (language === 'ar') {
    return [
      `أنتِ "سارة"، مسؤولة موارد بشرية محترفة بخبرة 10 سنوات في شركة عربية رائدة.`,
      `تُجرين الآن مقابلة وظيفية عبر مكالمة فيديو مع المرشح ${userName || 'المتقدّم'} لوظيفة في مجال "${categoryName}".`,
      ``,
      `القواعد الصارمة:`,
      `1. ردودكِ قصيرة جدًا: 1 إلى 3 جمل فقط، لأن الردود تُنطق بالصوت.`,
      `2. تحدّثي بالعربية الفصحى الواضحة، مع نبرة مهنية ودودة.`,
      `3. طرح سؤال واحد فقط في كل مرة، وانتظري إجابة المرشح.`,
      `4. تدرّجي من الأسهل للأصعب: بدئي بتعريف المرشح بنفسه، ثم خبرته، ثم سؤال تقني، ثم موقف سلوكي، ثم سؤال عن الراتب والتوقعات.`,
      `5. بعد أي إجابة، علّقي بجملة قصيرة (إيجابية أو استفهامية) ثم انتقلي للسؤال التالي.`,
      `6. لا تذكري أبدًا أنكِ ذكاء اصطناعي أو نموذج لغوي — أنتِ سارة، موظفة حقيقية.`,
      `7. عندما يصل عدد الأسئلة إلى 5-6، اختتمي المقابلة بشكره وإعطائه انطباع عام قصير (جملتان).`,
      `8. مدرّب المهارات: بعد كل إجابة من المرشح، قدّمي له 1-2 نصائح سريعة في خانة "tips" لتحسين إجابته القادمة (مثل "اذكر نتائج قابلة للقياس"، "استخدم طريقة STAR"). النصائح للمرشح فقط، لا تذكريها في ردك المنطوق. اترك "tips" فارغة [] في أول رسالة ترحيب.`,
      `9. أرجعي دائمًا JSON صالح بهذا الشكل فقط، بدون أي شيء خارجه:`,
      `{"reply": "نص الرد المنطوق", "status": "active" | "closing", "note": "ملاحظة داخلية", "tips": ["نصيحة قصيرة للمرشح"]}`,
    ].join('\n');
  }
  return [
    `You are "Sarah", a professional HR manager at a leading Arab company.`,
    `You're interviewing ${userName || 'the candidate'} for a "${categoryName}" role via video call.`,
    ``,
    `Strict rules:`,
    `1. Very short replies (1-3 sentences). They are read aloud.`,
    `2. Warm, professional English.`,
    `3. Ask ONE question at a time, then wait.`,
    `4. Progression: intro → experience → technical → behavioral → expectations.`,
    `5. Brief acknowledgment after each answer, then next question.`,
    `6. Never mention you are an AI or language model — you are Sarah.`,
    `7. After 5-6 questions, close the interview with thanks and a short impression (2 sentences).`,
    `8. Coaching: after each candidate answer, add 1-2 short tips in the "tips" array to help them improve their next answer (e.g. "Cite measurable outcomes", "Use STAR method"). Never speak these aloud. Empty array [] on the opener.`,
    `9. Return ONLY valid JSON:`,
    `{"reply": "spoken text", "status": "active" | "closing", "note": "internal note", "tips": ["coaching tip"]}`,
  ].join('\n');
}

async function callGroq(messages) {
  if (!env.AI_ENABLED || !env.GROQ_API_KEY) {
    throw new HttpError(503, 'AI_NOT_CONFIGURED');
  }
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.AI_MODEL || 'llama-3.3-70b-versatile',
      messages,
      temperature: 0.65,
      max_tokens: 400,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content || '',
    inputTokens: data.usage?.prompt_tokens || 0,
    outputTokens: data.usage?.completion_tokens || 0,
  };
}

function parseReply(raw) {
  const trimmed = (raw || '').trim();
  const tryParse = (s) => {
    try { return JSON.parse(s); } catch { return null; }
  };
  let p = tryParse(trimmed);
  if (!p) {
    const s = trimmed.indexOf('{');
    const e = trimmed.lastIndexOf('}');
    if (s !== -1 && e > s) p = tryParse(trimmed.slice(s, e + 1));
  }
  if (p?.reply) return p;
  // Last resort: treat the whole text as the spoken reply.
  return { reply: trimmed.slice(0, 500), status: 'active', note: '', tips: [] };
}

/* ----------------------------  routes  ---------------------------- */

const turnSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(3000),
  })).max(MAX_TURNS).default([]),
  userMessage: z.string().max(3000).optional().default(''),
  language: z.enum(['ar', 'en']).optional().default('ar'),
});

router.post('/turn', requireUser, aiLimiter, asyncHandler(async (req, res) => {
  const body = turnSchema.parse(req.body);

  // Validate category exists (raw mysql for safety under Prisma panic).
  const category = await queryOne(
    'SELECT id, name_ar AS nameAr, name_en AS nameEn, is_premium AS isPremium FROM categories WHERE id = ?',
    [body.categoryId]
  );
  if (!category) throw new HttpError(404, 'Category not found');

  // Block premium categories for free users.
  const userRow = await queryOne(
    'SELECT name, plan FROM users WHERE id = ?',
    [req.userId.toString()]
  );
  if (category.isPremium && userRow?.plan !== 'premium') {
    throw new HttpError(402, 'هذا القسم للمشتركين فقط / Premium subscription required');
  }

  // Build chat messages for Groq.
  const sys = systemPrompt({
    categoryName: body.language === 'ar' ? category.nameAr : category.nameEn,
    userName: userRow?.name,
    language: body.language,
  });

  const messages = [{ role: 'system', content: sys }];
  for (const turn of body.history) {
    messages.push({ role: turn.role, content: turn.content });
  }
  if (body.userMessage) {
    messages.push({ role: 'user', content: body.userMessage });
  } else if (body.history.length === 0) {
    // Empty history + empty user message → kick off with an opener instruction.
    messages.push({
      role: 'user',
      content: body.language === 'ar'
        ? '(بدء المقابلة — رحّبي بالمرشح وقدّمي نفسكِ في جملة، ثم اسألي سؤال التعريف الأول.)'
        : '(Start the interview — greet the candidate, introduce yourself in one sentence, then ask the first intro question.)',
    });
  }

  // Nudge Sarah to wrap up as turns grow.
  const assistantTurns = body.history.filter((h) => h.role === 'assistant').length + (body.userMessage ? 0 : 0);
  if (assistantTurns >= TARGET_TURNS / 2) {
    messages.push({
      role: 'system',
      content: body.language === 'ar'
        ? 'لقد طرحتِ عدة أسئلة — يمكنك البدء بالاختتام في الرد التالي إذا كانت الأجوبة كافية.'
        : 'You have asked several questions — you may begin closing in the next reply if answers are sufficient.',
    });
  }

  const start = Date.now();
  try {
    const { text, inputTokens, outputTokens } = await callGroq(messages);
    const parsed = parseReply(text);

    // Log token usage.
    prisma.claudeApiLog.create({
      data: {
        userId: req.userId,
        model: `groq:${env.AI_MODEL || 'llama-3.3-70b-versatile'}:meeting`,
        inputTokens, outputTokens,
        latencyMs: Date.now() - start,
        success: true,
      },
    }).catch((e) => logger.warn('meeting ai log failed', { message: e.message }));

    res.json({
      reply: parsed.reply,
      status: parsed.status === 'closing' ? 'closing' : 'active',
      note: parsed.note || '',
      tips: Array.isArray(parsed.tips) ? parsed.tips.slice(0, 3) : [],
      tokensUsed: inputTokens + outputTokens,
      turnIndex: body.history.length + (body.userMessage ? 1 : 0),
    });
  } catch (err) {
    logger.error('Meeting AI call failed', { message: err.message });
    prisma.claudeApiLog.create({
      data: {
        userId: req.userId,
        model: `groq:meeting`,
        inputTokens: 0, outputTokens: 0,
        latencyMs: Date.now() - start,
        success: false,
        errorMessage: err.message?.slice(0, 500),
      },
    }).catch(() => {});
    throw new HttpError(502, 'المحاور غير متاح حاليًا — حاول مرة أخرى خلال لحظات');
  }
}));

/* --------------------  final evaluation endpoint  ------------------- */

const finishSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(3000),
  })).min(2),
  language: z.enum(['ar', 'en']).optional().default('ar'),
});

router.post('/finish', requireUser, aiLimiter, asyncHandler(async (req, res) => {
  const body = finishSchema.parse(req.body);
  const category = await queryOne(
    'SELECT id, name_ar AS nameAr, name_en AS nameEn FROM categories WHERE id = ?',
    [body.categoryId]
  );
  if (!category) throw new HttpError(404, 'Category not found');

  const evalPrompt = body.language === 'ar'
    ? `قرأتِ محادثة مقابلة كاملة بين سارة (مسؤولة الموارد البشرية) والمرشح. قيّمي أداء المرشح بموضوعية وأعيدي JSON فقط:
{
  "overall_score": <0-10>,
  "summary": "جملتان مختصرتان",
  "strengths": ["..."],
  "weaknesses": ["..."],
  "recommendation": "hire" | "consider" | "reject",
  "advice": "نصيحة عملية للمرشح"
}`
    : `Read the full interview conversation between Sarah (HR) and the candidate. Evaluate objectively and return JSON only:
{
  "overall_score": <0-10>,
  "summary": "two brief sentences",
  "strengths": ["..."],
  "weaknesses": ["..."],
  "recommendation": "hire" | "consider" | "reject",
  "advice": "practical advice for the candidate"
}`;

  const transcript = body.history
    .map((t) => `${t.role === 'assistant' ? 'سارة' : 'المرشح'}: ${t.content}`)
    .join('\n');

  const messages = [
    { role: 'system', content: evalPrompt },
    { role: 'user', content: transcript },
  ];

  const { text, inputTokens, outputTokens } = await callGroq(messages);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const s = text.indexOf('{'), e = text.lastIndexOf('}');
    parsed = s !== -1 && e > s ? JSON.parse(text.slice(s, e + 1)) : null;
  }
  if (!parsed) throw new HttpError(502, 'Failed to parse evaluation');

  // Persist a session + answers so it shows up in History and Stats.
  try {
    const session = await prisma.session.create({
      data: {
        userId: req.userId,
        categoryId: body.categoryId,
        totalScore: Math.round((parsed.overall_score || 0) * body.history.filter((h) => h.role === 'user').length),
        startedAt: new Date(Date.now() - body.history.length * 60 * 1000),
        endedAt: new Date(),
      },
    });

    // Record a synthetic answer per user turn so History has the content.
    // Pair each user message with the PRECEDING assistant question.
    let lastQuestion = null;
    const answers = [];
    for (const turn of body.history) {
      if (turn.role === 'assistant') {
        lastQuestion = turn.content;
      } else if (turn.role === 'user' && lastQuestion) {
        answers.push({
          sessionId: session.id,
          // Use the first question in the DB as a stub — the actual text is in aiFeedback.
          questionId: BigInt(1),
          userAnswer: turn.content,
          aiScore: parsed.overall_score || 5,
          aiFeedback: JSON.stringify({
            question: lastQuestion,
            meeting: true,
            summary: parsed.summary,
          }),
          tokensUsed: 0,
        });
      }
    }
    if (answers.length) {
      await prisma.answer.createMany({ data: answers });
    }
  } catch (e) {
    logger.warn('Could not persist meeting session', { message: e.message });
  }

  prisma.claudeApiLog.create({
    data: {
      userId: req.userId,
      model: `groq:meeting-finish`,
      inputTokens, outputTokens,
      latencyMs: 0,
      success: true,
    },
  }).catch(() => {});

  res.json({ evaluation: parsed, tokensUsed: inputTokens + outputTokens });
}));

export default router;
