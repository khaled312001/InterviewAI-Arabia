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
import { cfg } from '../secrets/store.js';
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

/** Order of preference when nothing else decides — by evaluation quality. */
const PROVIDER_ORDER = ['claude', 'gemini', 'groq'];

/**
 * What each provider is called when nobody named a model for it.
 *
 * `AI_MODEL` is a SINGLE setting shared by every provider, which is fine while
 * only one is ever called and actively harmful the moment failover exists: an
 * operator who sets it to a Gemini model name — the only sensible thing to do
 * while Gemini is the provider — has thereby configured the Groq fallback to
 * request a model Groq has never heard of, so the fallback 400s instantly and
 * the outage it existed to absorb happens anyway.
 *
 * So `AI_MODEL` is honoured for the provider the operator actually chose, and
 * every OTHER provider is asked for its own default. Claude is absent on
 * purpose: it reads `CLAUDE_MODEL`, its own setting, so it never collides.
 */
const DEFAULT_MODEL = {
  gemini: 'gemini-flash-latest',
  groq: 'openai/gpt-oss-120b',
};

/**
 * A provider that just failed is skipped for a minute.
 *
 * Without this, an exhausted quota is paid for on every single turn: the
 * preferred provider is tried, waits out its timeout, fails, and only then
 * does the fallback run — so a candidate mid-interview eats that latency on
 * every answer for as long as the outage lasts. In-memory on purpose; a
 * process restart re-probing a provider is the correct behaviour, and this is
 * a health hint, not state worth a table.
 */
const COOLDOWN_MS = 60_000;
const cooldown = new Map();

/**
 * The wall-clock budget for trying providers in one call.
 *
 * Failover is only an improvement while the candidate is still in the room.
 * Each provider carries its own timeout and its own retries — Anthropic alone
 * is 60s x 4 in the worst case — so chaining three of them unbounded would
 * replace a fast failure with a two-minute silence, which is worse. The first
 * attempt always runs to completion; this only decides whether there is time
 * left to try another.
 */
const RUN_DEADLINE_MS = 45_000;

function markUnhealthy(provider) {
  cooldown.set(provider, Date.now() + COOLDOWN_MS);
}

function isCooling(provider) {
  const until = cooldown.get(provider);
  if (!until) return false;
  if (until <= Date.now()) { cooldown.delete(provider); return false; }
  return true;
}

function configuredProviders() {
  const available = {
    claude: claudeConfigured(),
    gemini: geminiConfigured(),
    groq: groqConfigured(),
  };
  const preferred = String(cfg('AI_PROVIDER') || 'claude').toLowerCase();
  const ordered = [
    ...(available[preferred] ? [preferred] : []),
    ...PROVIDER_ORDER.filter((p) => p !== preferred && available[p]),
  ];
  return ordered;
}

/**
 * The providers this call may use, best first.
 *
 * Cooling providers go to the BACK rather than out: if every key is unhappy at
 * once, trying a cooling one is still better than telling the candidate the
 * interviewer has vanished.
 */
function providerCandidates() {
  if (!cfg('AI_ENABLED')) return [];
  const ordered = configuredProviders();
  const warm = ordered.filter((p) => !isCooling(p));
  const cool = ordered.filter((p) => isCooling(p));
  return [...warm, ...cool];
}

function pickProvider() {
  return providerCandidates()[0] ?? null;
}

export function aiStatus() {
  const provider = pickProvider();
  return {
    enabled: Boolean(provider),
    provider,
    model: provider === 'claude'
      ? cfg('CLAUDE_MODEL')
      : cfg('AI_MODEL') || DEFAULT_MODEL[provider] || provider,
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
 *
 * Every configured provider is tried, best first, before this gives up. That
 * matters more than it sounds: `pickProvider` chose by CONFIGURATION, never by
 * health, so a single exhausted Gemini quota took the flagship live interview
 * down while a perfectly good Anthropic key sat unused in the same settings
 * page. The candidate saw "the interviewer is temporarily unavailable" and the
 * operator saw nothing wrong with their keys, because nothing was.
 *
 * Every attempt — including the failed ones — is written to the usage log, so
 * the admin panel shows which provider actually broke rather than only that
 * something did.
 */
async function run({ feature, userId, system, systemExtra, messages, schema, maxTokens, effort }) {
  const candidates = providerCandidates();
  if (candidates.length === 0) throw new AiUnavailableError('AI is not configured');

  const preferred = String(cfg('AI_PROVIDER') || 'claude').toLowerCase();

  let lastError = null;
  const startedAt = Date.now();

  for (const provider of candidates) {
    // Never skip the first attempt — there is nothing to fall back to yet.
    if (lastError && Date.now() - startedAt > RUN_DEADLINE_MS) {
      logger.warn('AI failover budget spent', { feature, tried: candidates.indexOf(provider) });
      break;
    }
    try {
      const call = { claude: callClaude, gemini: callGemini, groq: callGroq }[provider];
      // Only the chosen provider gets to use AI_MODEL; see DEFAULT_MODEL.
      const override = provider === preferred ? null : DEFAULT_MODEL[provider];
      const result = provider === 'claude'
        ? await call({ system, systemExtra, messages, schema, maxTokens, effort })
        : await call({
            system, systemExtra, messages, schema, maxTokens,
            ...(override ? { model: override } : null),
          });

      const cost = await record({ userId, provider, feature, usage: result.usage, success: true });
      cooldown.delete(provider);

      return {
        ...result,
        provider,
        costMicroUsd: cost,
        tokensUsed: (result.usage?.inputTokens || 0) + (result.usage?.outputTokens || 0),
      };
    } catch (err) {
      lastError = err;
      markUnhealthy(provider);
      logger.error('AI call failed', {
        feature, provider, code: err.code, message: err.message,
      });
      await record({
        userId, provider, feature,
        usage: { model: provider === 'claude' ? cfg('CLAUDE_MODEL') : cfg('AI_MODEL') || provider },
        success: false,
        errorMessage: err.message,
      });
    }
  }

  throw new AiUnavailableError(
    `AI ${feature} failed on ${candidates.join(', ')}: ${lastError?.message}`,
    lastError,
  );
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
