import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
// Load pdf-parse lazily so its debug-startup file probe doesn't crash the
// server if a test file is missing on the production install.
async function parsePdf(buffer) {
  const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
  return pdfParse(buffer);
}

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { requireUser } from '../middleware/auth.js';
import { aiLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { queryOne } from '../db/mysql.js';
import { prisma } from '../db/prisma.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB — plenty for a CV
});

/* -------------------------------------------------------------------------
 * Conversational interview — Sarah, an HR persona running a mock interview.
 * Context is optional but dramatically improves quality:
 *   - company, jobTitle, jobDescription (from the actual job posting)
 *   - cvSummary (extracted from a PDF the candidate uploads)
 * With context, Sarah asks tailored questions that reference the candidate's
 * real experience and the actual requirements of the role.
 * ----------------------------------------------------------------------- */

const MAX_TURNS = 20;
const TARGET_TURNS = 14;

function truncate(s, max) {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function contextBlock(ctx, language) {
  if (!ctx) return '';
  const ar = language === 'ar';
  const lines = [];
  if (ctx.company)        lines.push(ar ? `اسم الشركة: ${ctx.company}` : `Company: ${ctx.company}`);
  if (ctx.jobTitle)       lines.push(ar ? `المسمى الوظيفي: ${ctx.jobTitle}` : `Role: ${ctx.jobTitle}`);
  if (ctx.jobDescription) lines.push(ar ? `وصف الوظيفة من الإعلان:\n${truncate(ctx.jobDescription, 1200)}` : `Job description:\n${truncate(ctx.jobDescription, 1200)}`);
  if (ctx.cvSummary)      lines.push(ar ? `ملخص السيرة الذاتية للمرشح:\n${truncate(ctx.cvSummary, 1500)}` : `Candidate CV summary:\n${truncate(ctx.cvSummary, 1500)}`);
  return lines.length ? (ar ? '\n\nسياق المقابلة:\n' : '\n\nInterview context:\n') + lines.join('\n\n') : '';
}

// Two HR personas — candidate chooses before the interview starts.
function persona(gender) {
  return gender === 'male'
    ? { name: 'أحمد',  nameEn: 'Ahmed',  pronounAr: 'أجري', pronounEn: 'he', verbAr: 'مسؤول', intro: 'مرحبًا، أنا أحمد من قسم الموارد البشرية' }
    : { name: 'سارة', nameEn: 'Sarah',  pronounAr: 'أجرّي', pronounEn: 'she', verbAr: 'مسؤولة', intro: 'مرحبًا، أنا سارة من قسم الموارد البشرية' };
}

function systemPrompt({ categoryName, userName, language = 'ar', context = null, gender = 'female' }) {
  const p = persona(gender);
  const isHer = gender !== 'male';
  const youAre = isHer ? 'أنتِ' : 'أنت';
  const doAr = isHer ? 'تُجرين' : 'تُجري';
  const base = language === 'ar'
    ? [
      `${youAre} "${p.name}"، ${p.verbAr} موارد بشرية محترف بخبرة 10 سنوات في شركة عربية رائدة.`,
      context?.company
        ? `${doAr} مقابلة وظيفية عبر مكالمة فيديو مع ${userName || 'المرشح'} لوظيفة "${context.jobTitle || categoryName}" في شركة "${context.company}".`
        : `${doAr} مقابلة وظيفية عبر مكالمة فيديو مع ${userName || 'المرشح'} في مجال "${categoryName}".`,
      ``,
      `القواعد:`,
      `1. ردود قصيرة جدًا: 1-3 جمل فقط، لأنها تُنطق بالصوت.`,
      `2. عربية فصحى واضحة بنبرة مهنية ودودة.`,
      `3. سؤال واحد في كل مرة، ثم انتظري.`,
      `4. التدرّج: تعريف → خبرة → سؤال تقني → موقف سلوكي → توقعات/راتب.`,
      `5. بعد كل إجابة، علّقي جملة ثم انتقلي للسؤال التالي.`,
      `6. لا تذكري أنكِ AI. أنتِ سارة، موظفة حقيقية.`,
      context
        ? `7. اربطي أسئلتكِ بوصف الوظيفة المحدد وبخبرات المرشح في السيرة الذاتية — كنتِ قد قرأتِها قبل المقابلة. اسألي عن مشاريع محددة ذكرها أو مهارات محددة تطلبها الوظيفة.`
        : `7. في آخر المقابلة (بعد 5-6 أسئلة) اشكري المرشح واعطي انطباع قصير.`,
      `8. بعد كل إجابة من المرشح، ضعي 1-2 نصيحة في "tips" لتحسين إجابته القادمة${context ? '، مخصصة لمتطلبات هذه الوظيفة بالتحديد' : ''}. اتركيها [] في الترحيب الأول.`,
      `9. أرجعي JSON فقط:`,
      `{"reply":"...","status":"active"|"closing","note":"...","tips":["..."]}`,
    ]
    : [
      `You are "${p.nameEn}", a professional HR manager at a leading Arab company.`,
      context?.company
        ? `You're interviewing ${userName || 'the candidate'} for a "${context.jobTitle || categoryName}" role at "${context.company}" via video call.`
        : `You're interviewing ${userName || 'the candidate'} for a "${categoryName}" role via video call.`,
      ``,
      `Rules:`,
      `1. Very short replies (1-3 sentences) — spoken aloud.`,
      `2. Warm, professional English.`,
      `3. ONE question at a time.`,
      `4. Progression: intro → experience → technical → behavioral → expectations.`,
      `5. Brief acknowledgment, then next question.`,
      `6. Never reveal you are an AI.`,
      context
        ? `7. Ground your questions in the specific job description and candidate's CV — pretend you read them before the meeting. Reference concrete projects or required skills.`
        : `7. After 5-6 questions, close with thanks and a short impression.`,
      `8. After each candidate answer, add 1-2 short coaching tips tailored${context ? ' to this specific role' : ''}. Empty [] on opener.`,
      `9. Return JSON only:`,
      `{"reply":"...","status":"active"|"closing","note":"...","tips":["..."]}`,
    ];
  return base.join('\n') + contextBlock(context, language);
}

async function callGroq(messages, { maxTokens = 500 } = {}) {
  if (!env.AI_ENABLED || !env.GROQ_API_KEY) throw new HttpError(503, 'AI_NOT_CONFIGURED');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: env.AI_MODEL || 'llama-3.3-70b-versatile',
      messages,
      temperature: 0.65,
      max_tokens: maxTokens,
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
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
  let p = tryParse(trimmed);
  if (!p) {
    const s = trimmed.indexOf('{'); const e = trimmed.lastIndexOf('}');
    if (s !== -1 && e > s) p = tryParse(trimmed.slice(s, e + 1));
  }
  if (p?.reply) return p;
  return { reply: trimmed.slice(0, 500), status: 'active', note: '', tips: [] };
}

/* --------------------------- /prepare ----------------------------- */

router.post('/prepare', requireUser, upload.single('cv'), asyncHandler(async (req, res) => {
  const schema = z.object({
    categoryId: z.coerce.number().int().positive(),
    company: z.string().max(200).optional().default(''),
    jobTitle: z.string().max(200).optional().default(''),
    jobDescription: z.string().max(6000).optional().default(''),
    language: z.enum(['ar', 'en']).optional().default('ar'),
  });
  const body = schema.parse(req.body);

  // 1. Extract CV text (if uploaded).
  let cvText = '';
  let cvError = '';
  if (req.file) {
    try {
      if (req.file.mimetype === 'application/pdf' || req.file.originalname.toLowerCase().endsWith('.pdf')) {
        const parsed = await parsePdf(req.file.buffer);
        cvText = (parsed?.text || '').trim();
      } else if (req.file.mimetype.startsWith('text/') || /\.(txt|md)$/i.test(req.file.originalname)) {
        cvText = req.file.buffer.toString('utf-8').trim();
      } else {
        cvError = 'نوع الملف غير مدعوم — يُقبل PDF أو TXT فقط.';
      }
    } catch (err) {
      logger.warn('CV parse failed', { message: err.message });
      cvError = 'تعذّر قراءة السيرة الذاتية. حاول رفع نسخة PDF قابلة للنسخ (ليست صورة ممسوحة).';
    }
  }
  // Cap to keep Groq prompt reasonable — most real CVs fit in ~15k chars.
  if (cvText.length > 15000) cvText = cvText.slice(0, 15000) + '…';

  // 2. Summarize with Groq (name + years + skills + key roles + highlights).
  let cvSummary = '';
  let cvKey = null;
  if (cvText && env.AI_ENABLED && env.GROQ_API_KEY) {
    const sysPrompt = body.language === 'ar'
      ? `أنت محلّل سيّر ذاتية محترف. اقرأ السيرة الذاتية ولخّصها في JSON دقيق. أرجع JSON فقط بدون أي نص خارج JSON.`
      : `You are a professional CV analyst. Read the CV and summarize it in strict JSON. Return JSON only.`;
    const userPrompt = body.language === 'ar'
      ? `السيرة الذاتية:\n"""\n${cvText}\n"""\n\nأرجع JSON بهذا الشكل فقط:\n{\n  "full_name": "الاسم الكامل أو null",\n  "years_of_experience": <رقم تقديري>,\n  "latest_role": "آخر منصب/وظيفة شغلها",\n  "top_skills": ["أهم 8 مهارات مستخرجة"],\n  "highlights": ["3-5 إنجازات أو مشاريع لافتة"],\n  "education": "أعلى شهادة",\n  "summary_ar": "فقرة ملخصة عن المرشح في 3-5 جمل بالعربية"\n}`
      : `CV:\n"""\n${cvText}\n"""\n\nReturn JSON only:\n{\n  "full_name":"",\n  "years_of_experience": <number>,\n  "latest_role":"",\n  "top_skills":["up to 8"],\n  "highlights":["3-5"],\n  "education":"",\n  "summary_en":"3-5 sentences"\n}`;

    try {
      const { text, inputTokens, outputTokens } = await callGroq([
        { role: 'system', content: sysPrompt },
        { role: 'user', content: userPrompt },
      ], { maxTokens: 900 });
      try { cvKey = JSON.parse(text); }
      catch {
        const s = text.indexOf('{'); const e = text.lastIndexOf('}');
        if (s !== -1 && e > s) cvKey = JSON.parse(text.slice(s, e + 1));
      }
      cvSummary = cvKey ? [
        cvKey.full_name ? `الاسم: ${cvKey.full_name}` : null,
        cvKey.latest_role ? `آخر منصب: ${cvKey.latest_role}` : null,
        cvKey.years_of_experience ? `خبرة: ${cvKey.years_of_experience} سنوات` : null,
        cvKey.education ? `التعليم: ${cvKey.education}` : null,
        cvKey.top_skills?.length ? `أهم المهارات: ${cvKey.top_skills.join('، ')}` : null,
        cvKey.highlights?.length ? `أبرز الإنجازات:\n- ${cvKey.highlights.join('\n- ')}` : null,
        cvKey.summary_ar || cvKey.summary_en ? `\n${cvKey.summary_ar || cvKey.summary_en}` : null,
      ].filter(Boolean).join('\n') : truncate(cvText, 1500);

      prisma.claudeApiLog.create({
        data: {
          userId: req.userId,
          model: `groq:cv-summary`,
          inputTokens, outputTokens,
          latencyMs: 0, success: true,
        },
      }).catch(() => {});
    } catch (err) {
      logger.warn('CV summarize failed', { message: err.message });
      cvSummary = truncate(cvText, 1500);
    }
  } else if (cvText) {
    cvSummary = truncate(cvText, 1500);
  }

  // 3. Echo back the context the frontend should keep for the meeting turns.
  res.json({
    context: {
      categoryId: body.categoryId,
      company: body.company.trim() || null,
      jobTitle: body.jobTitle.trim() || null,
      jobDescription: body.jobDescription.trim() || null,
      cvSummary: cvSummary || null,
      cvKey,
    },
    cvError: cvError || null,
    cvHasText: !!cvText,
  });
}));

/* --------------------------- /turn ----------------------------- */

const contextSchema = z.object({
  categoryId: z.coerce.number().int().positive().optional(),
  company: z.string().max(200).nullable().optional(),
  jobTitle: z.string().max(200).nullable().optional(),
  jobDescription: z.string().max(6000).nullable().optional(),
  cvSummary: z.string().max(4000).nullable().optional(),
  cvKey: z.any().optional(),
  gender: z.enum(['male', 'female']).optional(),
}).nullable().optional();

const turnSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(3000),
  })).max(MAX_TURNS).default([]),
  userMessage: z.string().max(3000).optional().default(''),
  language: z.enum(['ar', 'en']).optional().default('ar'),
  context: contextSchema,
});

router.post('/turn', requireUser, aiLimiter, asyncHandler(async (req, res) => {
  const body = turnSchema.parse(req.body);

  const category = await queryOne(
    'SELECT id, name_ar AS nameAr, name_en AS nameEn, is_premium AS isPremium FROM categories WHERE id = ?',
    [body.categoryId]
  );
  if (!category) throw new HttpError(404, 'Category not found');

  const userRow = await queryOne(
    'SELECT name, plan FROM users WHERE id = ?',
    [req.userId.toString()]
  );
  if (category.isPremium && userRow?.plan !== 'premium') {
    throw new HttpError(402, 'هذا القسم للمشتركين فقط / Premium subscription required');
  }

  const sys = systemPrompt({
    categoryName: body.language === 'ar' ? category.nameAr : category.nameEn,
    userName: userRow?.name,
    language: body.language,
    context: body.context || null,
    gender: body.context?.gender || 'female',
  });

  const messages = [{ role: 'system', content: sys }];
  for (const turn of body.history) messages.push({ role: turn.role, content: turn.content });

  if (body.userMessage) {
    messages.push({ role: 'user', content: body.userMessage });
  } else if (body.history.length === 0) {
    messages.push({
      role: 'user',
      content: body.language === 'ar'
        ? '(بدء المقابلة — رحّبي بالمرشح باسمه إن توفّر، قدّمي نفسكِ واسم الشركة، ثم اطرحي السؤال الأول التعريفي.)'
        : '(Start — greet the candidate by name if known, introduce yourself and the company, then ask the first intro question.)',
    });
  }

  const assistantTurns = body.history.filter((h) => h.role === 'assistant').length;
  if (assistantTurns >= TARGET_TURNS / 2) {
    messages.push({
      role: 'system',
      content: body.language === 'ar'
        ? 'لقد غطّيتِ عدة محاور — يمكنكِ البدء بالاختتام في الرد التالي إذا كانت الأجوبة كافية.'
        : 'Several topics covered — you may begin closing if answers are sufficient.',
    });
  }

  const start = Date.now();
  try {
    const { text, inputTokens, outputTokens } = await callGroq(messages);
    const parsed = parseReply(text);

    prisma.claudeApiLog.create({
      data: {
        userId: req.userId,
        model: `groq:${env.AI_MODEL || 'llama-3.3-70b-versatile'}:meeting`,
        inputTokens, outputTokens,
        latencyMs: Date.now() - start,
        success: true,
      },
    }).catch(() => {});

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
    throw new HttpError(502, 'المحاور غير متاح حاليًا — حاول مرة أخرى');
  }
}));

/* --------------------------- /finish ----------------------------- */

const finishSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(3000),
  })).min(2),
  language: z.enum(['ar', 'en']).optional().default('ar'),
  context: contextSchema,
});

router.post('/finish', requireUser, aiLimiter, asyncHandler(async (req, res) => {
  const body = finishSchema.parse(req.body);
  const category = await queryOne('SELECT id, name_ar AS nameAr, name_en AS nameEn FROM categories WHERE id = ?', [body.categoryId]);
  if (!category) throw new HttpError(404, 'Category not found');

  const evalPrompt = body.language === 'ar'
    ? `قرأتِ محادثة مقابلة بين سارة والمرشح${body.context?.company ? ` لوظيفة "${body.context.jobTitle}" في شركة "${body.context.company}"` : ''}. قيّمي المرشح بموضوعية وأرجعي JSON فقط:
{
  "overall_score": <0-10>,
  "summary": "جملتان",
  "strengths": ["..."],
  "weaknesses": ["..."],
  "job_fit": <0-100 نسبة ملاءمة المرشح للوظيفة>,
  "recommendation": "hire"|"consider"|"reject",
  "advice": "نصيحة عملية قابلة للتطبيق"
}`
    : `Evaluate this interview conversation objectively. Return JSON only with overall_score (0-10), summary, strengths, weaknesses, job_fit (0-100), recommendation, advice.`;

  const transcript = body.history
    .map((t) => `${t.role === 'assistant' ? 'سارة' : 'المرشح'}: ${t.content}`)
    .join('\n');

  const ctxStr = body.context ? contextBlock(body.context, body.language) : '';
  const { text, inputTokens, outputTokens } = await callGroq([
    { role: 'system', content: evalPrompt + ctxStr },
    { role: 'user', content: transcript },
  ], { maxTokens: 1000 });

  let parsed;
  try { parsed = JSON.parse(text); }
  catch {
    const s = text.indexOf('{'), e = text.lastIndexOf('}');
    parsed = s !== -1 && e > s ? JSON.parse(text.slice(s, e + 1)) : null;
  }
  if (!parsed) throw new HttpError(502, 'Failed to parse evaluation');

  // Persist as a session for History / Stats.
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

    let lastQuestion = null;
    const answers = [];
    for (const turn of body.history) {
      if (turn.role === 'assistant') lastQuestion = turn.content;
      else if (turn.role === 'user' && lastQuestion) {
        answers.push({
          sessionId: session.id,
          questionId: BigInt(1),
          userAnswer: turn.content,
          aiScore: parsed.overall_score || 5,
          aiFeedback: JSON.stringify({ question: lastQuestion, meeting: true, summary: parsed.summary }),
          tokensUsed: 0,
        });
      }
    }
    if (answers.length) await prisma.answer.createMany({ data: answers });
  } catch (e) {
    logger.warn('Could not persist meeting session', { message: e.message });
  }

  prisma.claudeApiLog.create({
    data: {
      userId: req.userId,
      model: `groq:meeting-finish`,
      inputTokens, outputTokens,
      latencyMs: 0, success: true,
    },
  }).catch(() => {});

  res.json({ evaluation: parsed, tokensUsed: inputTokens + outputTokens });
}));

export default router;
