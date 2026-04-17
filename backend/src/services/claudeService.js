import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { prisma } from '../db/prisma.js';

let client = null;
function getClient() {
  if (!env.CLAUDE_ENABLED || !env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

function systemPrompt(language) {
  return language === 'ar'
    ? 'أنت محاور موارد بشرية محترف ومتخصص في المقابلات الوظيفية باللغة العربية. قيّم إجابة المستخدم بدقة وموضوعية، مع الأخذ في الاعتبار السياق الثقافي والمهني في منطقة الشرق الأوسط. أعط درجة من 0 إلى 10، ونقاط قوة، ونقاط ضعف، واقتراح للتحسين، وإجابة نموذجية. أرجع JSON فقط دون أي نص إضافي.'
    : 'You are a professional HR interviewer. Evaluate the user\'s answer objectively. Provide a score 0-10, strengths, weaknesses, improvement advice, and a model answer. Respond with JSON only — no prose.';
}

function userPrompt({ question, userAnswer, language }) {
  if (language === 'ar') {
    return `السؤال: ${question}\n\nإجابة المستخدم: ${userAnswer}\n\nقيّم الإجابة وأرجع JSON بالشكل التالي فقط:\n{\n  "score": <رقم من 0 إلى 10>,\n  "strengths": ["..."],\n  "weaknesses": ["..."],\n  "improvement": "...",\n  "model_answer": "..."\n}`;
  }
  return `Question: ${question}\n\nUser answer: ${userAnswer}\n\nReturn JSON only:\n{\n  "score": <0-10 integer>,\n  "strengths": ["..."],\n  "weaknesses": ["..."],\n  "improvement": "...",\n  "model_answer": "..."\n}`;
}

function stubResult(language) {
  return language === 'ar'
    ? {
        score: 6,
        strengths: ['لم يتم تفعيل تقييم Claude — هذه نتيجة تجريبية'],
        weaknesses: ['يرجى تعيين ANTHROPIC_API_KEY وضبط CLAUDE_ENABLED=true'],
        improvement: 'فعّل تكامل Claude للحصول على تقييم حقيقي.',
        model_answer: 'إجابة نموذجية ستظهر هنا عند تفعيل Claude.',
        stub: true,
      }
    : {
        score: 6,
        strengths: ['Claude evaluation disabled — stub response'],
        weaknesses: ['Set ANTHROPIC_API_KEY and CLAUDE_ENABLED=true'],
        improvement: 'Enable Claude integration for a real evaluation.',
        model_answer: 'Model answer will appear here when Claude is enabled.',
        stub: true,
      };
}

function extractJson(text) {
  const trimmed = text.trim();
  // Try straight JSON first.
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  // Claude sometimes wraps in ```json fences.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch { /* fall through */ }
  }
  // Try the first {...} block.
  const braceStart = trimmed.indexOf('{');
  const braceEnd = trimmed.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    try { return JSON.parse(trimmed.slice(braceStart, braceEnd + 1)); } catch { /* fall through */ }
  }
  throw new Error('Failed to parse Claude response as JSON');
}

export async function evaluateAnswer({ question, userAnswer, language = 'ar', userId = null }) {
  const c = getClient();
  if (!c) {
    return { result: stubResult(language), tokensUsed: 0 };
  }

  const start = Date.now();
  try {
    const response = await c.messages.create({
      model: env.CLAUDE_MODEL,
      max_tokens: 1024,
      system: systemPrompt(language),
      messages: [{ role: 'user', content: userPrompt({ question, userAnswer, language }) }],
    });

    const text = response.content?.[0]?.type === 'text' ? response.content[0].text : '';
    const parsed = extractJson(text);
    const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

    await prisma.claudeApiLog.create({
      data: {
        userId: userId ?? null,
        model: env.CLAUDE_MODEL,
        inputTokens: response.usage?.input_tokens || 0,
        outputTokens: response.usage?.output_tokens || 0,
        latencyMs: Date.now() - start,
        success: true,
      },
    }).catch((e) => logger.warn('claude log failed', { message: e.message }));

    return { result: parsed, tokensUsed };
  } catch (err) {
    logger.error('Claude evaluation failed', { message: err.message });
    await prisma.claudeApiLog.create({
      data: {
        userId: userId ?? null,
        model: env.CLAUDE_MODEL,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - start,
        success: false,
        errorMessage: err.message?.slice(0, 500),
      },
    }).catch(() => {});
    return {
      result: {
        ...stubResult(language),
        error: 'Claude call failed — returning a stub. Check server logs.',
      },
      tokensUsed: 0,
    };
  }
}
