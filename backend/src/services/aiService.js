// Unified AI evaluator — pluggable providers. Default: Groq (free, fast,
// OpenAI-compatible). Alternatives supported with near-zero code changes:
// OpenRouter, Google Gemini. Claude lives behind CLAUDE_ENABLED if kept.
//
// Why a unified service: the brief originally called for Claude but billing
// wasn't in place. Groq's free tier + Llama 3.3 70B handles professional
// Arabic interview evaluation at near-Claude quality with zero cost.

import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { prisma } from '../db/prisma.js';

/* ---------------------------- prompts ----------------------------- */

function systemPrompt(language) {
  return language === 'ar'
    ? 'أنت محاور موارد بشرية محترف متخصص في سوق العمل العربي. قيّم إجابة المرشح بدقة وموضوعية بالسياق الثقافي والمهني للشرق الأوسط. أعد JSON فقط دون أي نص خارج JSON.'
    : 'You are a professional HR interviewer. Evaluate the candidate answer objectively. Respond with JSON only — no prose outside JSON.';
}

function userPrompt({ question, userAnswer, language }) {
  if (language === 'ar') {
    return [
      `السؤال: ${question}`,
      '',
      `إجابة المرشح: ${userAnswer}`,
      '',
      'أعد JSON صالح فقط بهذا الشكل:',
      '{',
      '  "score": <رقم من 0 إلى 10>,',
      '  "strengths": ["...","..."],',
      '  "weaknesses": ["...","..."],',
      '  "improvement": "نصيحة واحدة عملية",',
      '  "model_answer": "إجابة نموذجية قصيرة"',
      '}',
    ].join('\n');
  }
  return [
    `Question: ${question}`,
    '',
    `Candidate answer: ${userAnswer}`,
    '',
    'Respond with valid JSON only:',
    '{',
    '  "score": <0-10 integer>,',
    '  "strengths": ["...","..."],',
    '  "weaknesses": ["...","..."],',
    '  "improvement": "one practical tip",',
    '  "model_answer": "short model answer"',
    '}',
  ].join('\n');
}

function stubResult(language) {
  return language === 'ar'
    ? {
        score: 6,
        strengths: ['لم يتم تفعيل AI — هذه نتيجة تجريبية', 'الإجابة مقبولة مبدئيًا'],
        weaknesses: ['يرجى تعيين GROQ_API_KEY (أو مفتاح مزوّد آخر) وضبط AI_ENABLED=true'],
        improvement: 'فعّل تكامل AI للحصول على تقييم حقيقي من نموذج لغوي كبير.',
        model_answer: 'الإجابة النموذجية ستظهر هنا عند تفعيل AI.',
        stub: true,
      }
    : {
        score: 6,
        strengths: ['AI evaluation disabled — stub response'],
        weaknesses: ['Set GROQ_API_KEY and AI_ENABLED=true'],
        improvement: 'Enable AI integration for a real evaluation.',
        model_answer: 'Model answer will appear here when AI is enabled.',
        stub: true,
      };
}

function extractJson(text) {
  const trimmed = (text || '').trim();
  try { return JSON.parse(trimmed); } catch {}
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch {} }
  const s = trimmed.indexOf('{');
  const e = trimmed.lastIndexOf('}');
  if (s !== -1 && e > s) { try { return JSON.parse(trimmed.slice(s, e + 1)); } catch {} }
  throw new Error('Failed to parse AI response as JSON');
}

/* ---------------------------- providers ---------------------------- */

// Groq uses an OpenAI-compatible endpoint. Fast, free tier, quality Llama/Mixtral.
async function callGroq({ system, user, model, maxTokens = 1024 }) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: model || 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.4,
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

// OpenRouter aggregates many models (incl. free tiers). OpenAI-compatible.
async function callOpenRouter({ system, user, model, maxTokens = 1024 }) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://intervie-ai-arabia.barmagly.tech',
      'X-Title': 'InterviewAI Arabia',
    },
    body: JSON.stringify({
      model: model || 'meta-llama/llama-3.3-70b-instruct:free',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.4,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content || '',
    inputTokens: data.usage?.prompt_tokens || 0,
    outputTokens: data.usage?.completion_tokens || 0,
  };
}

// Google Gemini — free tier with generous limits.
async function callGemini({ system, user, model, maxTokens = 1024 }) {
  const m = model || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: user }] }],
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json',
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return {
    text: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
    inputTokens: data.usageMetadata?.promptTokenCount || 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
  };
}

// Claude kept for compatibility but not the default anymore.
let claudeClient = null;
async function callClaude({ system, user, model, maxTokens = 1024 }) {
  if (!claudeClient) claudeClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const response = await claudeClient.messages.create({
    model: model || 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return {
    text: response.content?.[0]?.type === 'text' ? response.content[0].text : '',
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
  };
}

/* ---------------------------- dispatcher ---------------------------- */

function pickProvider() {
  if (!env.AI_ENABLED) return null;
  const p = (env.AI_PROVIDER || 'groq').toLowerCase();
  const haveKey = {
    groq: !!env.GROQ_API_KEY,
    openrouter: !!env.OPENROUTER_API_KEY,
    gemini: !!env.GEMINI_API_KEY,
    claude: !!env.ANTHROPIC_API_KEY,
  };
  if (haveKey[p]) return p;
  // Fallback to any provider that has a key.
  for (const candidate of ['groq', 'openrouter', 'gemini', 'claude']) {
    if (haveKey[candidate]) return candidate;
  }
  return null;
}

async function callProvider(provider, args) {
  switch (provider) {
    case 'groq':       return callGroq(args);
    case 'openrouter': return callOpenRouter(args);
    case 'gemini':     return callGemini(args);
    case 'claude':     return callClaude(args);
    default: throw new Error(`Unknown AI provider: ${provider}`);
  }
}

/* --------------------------- public API --------------------------- */

export async function evaluateAnswer({ question, userAnswer, language = 'ar', userId = null }) {
  const provider = pickProvider();
  if (!provider) return { result: stubResult(language), tokensUsed: 0 };

  const start = Date.now();
  const system = systemPrompt(language);
  const user = userPrompt({ question, userAnswer, language });
  const model = env.AI_MODEL || undefined;

  try {
    const { text, inputTokens, outputTokens } = await callProvider(provider, { system, user, model });
    const parsed = extractJson(text);

    await prisma.claudeApiLog.create({
      data: {
        userId: userId ?? null,
        model: `${provider}:${model || 'default'}`,
        inputTokens, outputTokens,
        latencyMs: Date.now() - start,
        success: true,
      },
    }).catch((e) => logger.warn('ai log failed', { message: e.message }));

    return { result: parsed, tokensUsed: inputTokens + outputTokens };
  } catch (err) {
    logger.error('AI evaluation failed', { provider, message: err.message });
    await prisma.claudeApiLog.create({
      data: {
        userId: userId ?? null,
        model: `${provider}:${model || 'default'}`,
        inputTokens: 0, outputTokens: 0,
        latencyMs: Date.now() - start,
        success: false,
        errorMessage: err.message?.slice(0, 500),
      },
    }).catch(() => {});
    return {
      result: { ...stubResult(language), error: `AI call failed (${provider}) — returning a stub.` },
      tokensUsed: 0,
    };
  }
}
