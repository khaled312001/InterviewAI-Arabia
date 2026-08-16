/**
 * The product's AI surface.
 *
 * Every model call in the app goes through this module. The meeting routes
 * previously called Groq directly with their own copy of the JSON-scraping
 * logic, which meant "switching provider" silently left the flagship live
 * interview on the old vendor.
 *
 * Failure policy — the most important change from the previous build:
 * these functions THROW. The old `evaluateAnswer` caught every error and
 * returned a stub scored 6/10, which the route then persisted as a real
 * grade and charged against the user's daily quota. A user could be told
 * "you scored 6" for an answer no model ever read. Callers must now handle
 * the error and decline to charge the user.
 */

import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { prisma } from '../../db/prisma.js';
import { costMicroUsd } from './pricing.js';
import { callClaude, isConfigured as claudeConfigured } from './claude.js';
import { callGroq, isConfigured as groqConfigured } from './groq.js';
import { callGemini, isConfigured as geminiConfigured } from './gemini.js';
import {
  EVALUATE_SYSTEM_AR, EVALUATE_SYSTEM_EN, EVALUATION_SCHEMA, evaluateUserPrompt,
  MEETING_TURN_SCHEMA, meetingSystemStable, meetingContextBlock,
  INTERVIEW_EVALUATION_SCHEMA, INTERVIEW_EVALUATION_SYSTEM_AR, INTERVIEW_EVALUATION_SYSTEM_EN,
  CV_SCHEMA, CV_SYSTEM_AR, CV_SYSTEM_EN, fence,
} from './prompts.js';

export class AiUnavailableError extends Error {
  constructor(message = 'AI service unavailable', cause) {
    super(message);
    this.name = 'AiUnavailableError';
    this.code = 'AI_UNAVAILABLE';
    this.cause = cause;
  }
}

/* ------------------------------------------------------------------ *
 * Provider selection
 * ------------------------------------------------------------------ */

function pickProvider() {
  if (!env.AI_ENABLED) return null;
  const preferred = (env.AI_PROVIDER || 'claude').toLowerCase();
  const available = {
    claude: claudeConfigured(),
    gemini: geminiConfigured(),
    groq: groqConfigured(),
  };
  if (available[preferred]) return preferred;
  // Fall through to any configured provider rather than failing outright —
  // a degraded answer beats a dead feature. Order is by evaluation quality.
  for (const p of ['claude', 'gemini', 'groq']) if (available[p]) return p;
  return null;
}

export function aiStatus() {
  const provider = pickProvider();
  return {
    enabled: Boolean(provider),
    provider,
    model: provider === 'claude'
      ? env.CLAUDE_MODEL
      : env.AI_MODEL || (provider === 'gemini' ? 'gemini-flash-latest' : 'llama-3.3-70b-versatile'),
  };
}

/**
 * Records usage and cost. Never throws — telemetry must not be able to fail
 * a request the user already paid for in quota.
 */
async function record({ userId, provider, feature, usage, success, errorMessage }) {
  const cost = success
    ? costMicroUsd({ provider, model: usage?.model, ...usage })
    : 0;
  try {
    await prisma.aiUsageLog.create({
      data: {
        userId: userId ?? null,
        provider,
        model: usage?.model || 'unknown',
        feature,
        inputTokens: usage?.inputTokens || 0,
        outputTokens: usage?.outputTokens || 0,
        cacheReadTokens: usage?.cacheReadTokens || 0,
        cacheWriteTokens: usage?.cacheWriteTokens || 0,
        costMicroUsd: cost,
        latencyMs: usage?.latencyMs || 0,
        success,
        errorMessage: errorMessage ? String(errorMessage).slice(0, 500) : null,
      },
    });
  } catch (e) {
    logger.warn('ai usage log failed', { message: e.message });
  }
  return cost;
}

/**
 * Dispatch to the active provider and log the outcome either way.
 */
async function run({ feature, userId, system, systemExtra, messages, schema, maxTokens, effort }) {
  const provider = pickProvider();
  if (!provider) throw new AiUnavailableError('AI is not configured');

  try {
    const call = { claude: callClaude, gemini: callGemini, groq: callGroq }[provider];
    const result = provider === 'claude'
      ? await call({ system, systemExtra, messages, schema, maxTokens, effort })
      : await call({ system, systemExtra, messages, schema, maxTokens });

    const cost = await record({ userId, provider, feature, usage: result.usage, success: true });

    return {
      ...result,
      provider,
      costMicroUsd: cost,
      tokensUsed: (result.usage?.inputTokens || 0) + (result.usage?.outputTokens || 0),
    };
  } catch (err) {
    logger.error('AI call failed', {
      feature, provider, code: err.code, message: err.message,
    });
    await record({
      userId, provider, feature,
      usage: { model: provider === 'claude' ? env.CLAUDE_MODEL : env.AI_MODEL || provider },
      success: false,
      errorMessage: err.message,
    });
    throw new AiUnavailableError(`AI ${feature} failed: ${err.message}`, err);
  }
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Grade one interview answer.
 * @throws {AiUnavailableError} — the caller MUST NOT persist a score or
 *         consume quota when this throws.
 */
export async function evaluateAnswer({ question, userAnswer, language = 'ar', userId = null, jobTitle = null }) {
  const { parsed, usage, provider, costMicroUsd: cost, tokensUsed } = await run({
    feature: 'evaluate',
    userId,
    system: language === 'ar' ? EVALUATE_SYSTEM_AR : EVALUATE_SYSTEM_EN,
    messages: [{ role: 'user', content: evaluateUserPrompt({ question, userAnswer, language, jobTitle }) }],
    schema: EVALUATION_SCHEMA,
    maxTokens: 4096,
    effort: 'low',
  });

  if (parsed.injection_attempt) {
    logger.warn('Prompt injection attempt in candidate answer', { userId: userId?.toString?.() });
  }

  return {
    result: {
      score: parsed.score,
      breakdown: {
        relevance: parsed.relevance,
        specificity: parsed.specificity,
        structure: parsed.structure,
        depth: parsed.depth,
      },
      strengths: parsed.strengths,
      weaknesses: parsed.weaknesses,
      improvement: parsed.improvement,
      model_answer: parsed.model_answer,
    },
    tokensUsed,
    costMicroUsd: cost,
    provider,
    model: usage.model,
  };
}

/**
 * One turn of the live mock interview.
 */
export async function meetingTurn({
  history = [], userMessage = '', language = 'ar', gender = 'female',
  context = null, userId = null, shouldClose = false,
}) {
  const messages = history.map((h) => ({
    role: h.role,
    content: h.role === 'user'
      // Candidate speech is untrusted; fence it the same way written answers are.
      ? `<candidate_answer>${fence(h.content, 3000)}</candidate_answer>`
      : h.content,
  }));

  if (userMessage) {
    messages.push({ role: 'user', content: `<candidate_answer>${fence(userMessage, 3000)}</candidate_answer>` });
  } else if (history.length === 0) {
    messages.push({
      role: 'user',
      content: language === 'ar'
        ? '(ابدئي المقابلة: رحّبي بالمرشح باسمه إن كان معروفًا، عرّفي بنفسكِ وبالشركة، ثم اطرحي السؤال التعريفي الأول.)'
        : '(Start the interview: greet the candidate by name if known, introduce yourself and the company, then ask your first introductory question.)',
    });
  }

  if (shouldClose) {
    messages.push({
      role: 'user',
      content: language === 'ar'
        ? '(تعليمات للمحاورة: غطّيتِ محاور كافية — ابدئي الاختتام في ردكِ التالي.)'
        : '(Interviewer note: enough ground covered — begin closing on your next reply.)',
    });
  }

  const { parsed, usage, provider, costMicroUsd: cost, tokensUsed } = await run({
    feature: 'meeting_turn',
    userId,
    // Stable half carries the cache breakpoint...
    system: meetingSystemStable({ language, gender }),
    // ...volatile interview context sits after it.
    systemExtra: meetingContextBlock(context, language),
    messages,
    schema: MEETING_TURN_SCHEMA,
    maxTokens: 2048,
    effort: 'low',
  });

  return {
    reply: parsed.reply,
    status: parsed.status,
    note: parsed.note,
    tips: (parsed.tips || []).slice(0, 3),
    tokensUsed,
    costMicroUsd: cost,
    provider,
    model: usage.model,
  };
}

/**
 * Final evaluation of a completed live interview.
 */
export async function evaluateInterview({ history, language = 'ar', context = null, userId = null }) {
  const transcript = history
    .map((t) => `${t.role === 'assistant' ? (language === 'ar' ? 'المحاور' : 'Interviewer') : (language === 'ar' ? 'المرشح' : 'Candidate')}: ${t.content}`)
    .join('\n');

  const { parsed, usage, provider, costMicroUsd: cost, tokensUsed } = await run({
    feature: 'interview_eval',
    userId,
    system: language === 'ar' ? INTERVIEW_EVALUATION_SYSTEM_AR : INTERVIEW_EVALUATION_SYSTEM_EN,
    systemExtra: meetingContextBlock(context, language),
    messages: [{ role: 'user', content: `<transcript>${fence(transcript, 24000)}</transcript>` }],
    schema: INTERVIEW_EVALUATION_SCHEMA,
    maxTokens: 8192,
    effort: 'medium',
  });

  return { evaluation: parsed, tokensUsed, costMicroUsd: cost, provider, model: usage.model };
}

/**
 * Extract structured data from CV text.
 */
export async function summarizeCv({ cvText, language = 'ar', userId = null }) {
  const { parsed, usage, provider, costMicroUsd: cost, tokensUsed } = await run({
    feature: 'cv_summary',
    userId,
    system: language === 'ar' ? CV_SYSTEM_AR : CV_SYSTEM_EN,
    messages: [{ role: 'user', content: `<cv>${fence(cvText, 18000)}</cv>` }],
    schema: CV_SCHEMA,
    maxTokens: 4096,
    effort: 'low',
  });

  const lines = [
    parsed.full_name && `الاسم: ${parsed.full_name}`,
    parsed.latest_role && `آخر منصب: ${parsed.latest_role}`,
    parsed.years_of_experience ? `سنوات الخبرة: ${parsed.years_of_experience}` : null,
    parsed.education && `التعليم: ${parsed.education}`,
    parsed.top_skills?.length && `أهم المهارات: ${parsed.top_skills.join('، ')}`,
    parsed.highlights?.length && `أبرز الإنجازات:\n- ${parsed.highlights.join('\n- ')}`,
    parsed.summary && `\n${parsed.summary}`,
  ].filter(Boolean);

  return {
    cvKey: parsed,
    cvSummary: lines.join('\n'),
    tokensUsed,
    costMicroUsd: cost,
    provider,
    model: usage.model,
  };
}
