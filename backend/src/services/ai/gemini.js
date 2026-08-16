/**
 * Google Gemini provider.
 *
 * Exists because Gemini currently has the most usable *free* tier of any
 * hosted LLM (1,500 requests/day on Flash, no card, no expiry), which makes it
 * the practical way to run this product before there is revenue to pay for
 * Claude. It speaks the same `{ parsed, text, usage }` contract as the Claude
 * and Groq providers, so nothing above it changes.
 *
 * Quality note: Gemini Flash is meaningfully weaker than Claude at Arabic
 * interview evaluation — expect blunter feedback and looser rubric adherence.
 * Treat it as the free-tier path, not the destination.
 */

import { env } from '../../config/env.js';
import { cfg } from '../secrets/store.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;

export function isConfigured() {
  return Boolean(cfg('GEMINI_API_KEY'));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isRetryable = (s) => s === 408 || s === 429 || (s >= 500 && s < 600);

/**
 * Gemini's `responseSchema` is a subset of OpenAPI, not JSON Schema. It
 * rejects `additionalProperties` and `enum` on integers, both of which our
 * shared schemas use for Claude's structured outputs — so translate rather
 * than pass the schema through.
 */
function toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return undefined;

  const convert = (node) => {
    if (!node || typeof node !== 'object') return node;

    if (node.type === 'object') {
      const props = {};
      for (const [k, v] of Object.entries(node.properties || {})) props[k] = convert(v);
      return {
        type: 'OBJECT',
        properties: props,
        // Gemini honours `required` and ignores unknown keys, so dropping
        // additionalProperties is safe.
        ...(node.required ? { required: node.required } : {}),
      };
    }
    if (node.type === 'array') {
      return { type: 'ARRAY', items: convert(node.items) };
    }
    if (node.type === 'integer') {
      // An integer `enum` is invalid in Gemini's dialect; the range is
      // re-clamped by the caller anyway.
      return { type: 'INTEGER', ...(node.description ? { description: node.description } : {}) };
    }
    if (node.type === 'number')  return { type: 'NUMBER' };
    if (node.type === 'boolean') return { type: 'BOOLEAN' };
    if (node.type === 'string') {
      return {
        type: 'STRING',
        ...(Array.isArray(node.enum) ? { enum: node.enum } : {}),
        ...(node.description ? { description: node.description } : {}),
      };
    }
    return { type: 'STRING' };
  };

  return convert(schema);
}

export async function callGemini({
  system,
  systemExtra,
  messages,
  schema,
  maxTokens = 2048,
  model = cfg('AI_MODEL') || 'gemini-flash-latest',
}) {
  if (!isConfigured()) throw new Error('GEMINI_API_KEY is not set');

  const systemText = [system, systemExtra].filter(Boolean).join('\n\n');

  // Gemini uses `model` where the others use `assistant`.
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
  }));

  const body = {
    contents,
    systemInstruction: { parts: [{ text: systemText }] },
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: maxTokens,
      ...(schema
        ? { responseMimeType: 'application/json', responseSchema: toGeminiSchema(schema) }
        : {}),
    },
  };

  const started = Date.now();
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE}/${model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Header rather than ?key= so the secret never lands in access logs.
          'x-goog-api-key': cfg('GEMINI_API_KEY'),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        const err = new Error(`Gemini HTTP ${res.status}: ${detail}`);
        err.status = res.status;
        if (isRetryable(res.status) && attempt < MAX_ATTEMPTS) {
          lastError = err;
          await sleep(2 ** attempt * 300 + Math.random() * 250);
          continue;
        }
        throw err;
      }

      const data = await res.json();
      const cand = data.candidates?.[0];

      // Safety blocks come back as 200 with no content and a finishReason.
      if (!cand || cand.finishReason === 'SAFETY' || cand.finishReason === 'PROHIBITED_CONTENT') {
        const err = new Error(`Gemini declined the request (${cand?.finishReason ?? 'no candidate'})`);
        err.code = 'AI_REFUSED';
        throw err;
      }
      if (cand.finishReason === 'MAX_TOKENS') {
        const err = new Error('Gemini hit maxOutputTokens before completing');
        err.code = 'AI_TRUNCATED';
        throw err;
      }

      const text = (cand.content?.parts || []).map((p) => p.text || '').join('');

      const usage = {
        inputTokens: data.usageMetadata?.promptTokenCount || 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
        cacheReadTokens: data.usageMetadata?.cachedContentTokenCount || 0,
        cacheWriteTokens: 0,
        latencyMs: Date.now() - started,
        model,
      };

      if (!schema) return { text, usage };

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (cause) {
        const err = new Error('Gemini returned a response that is not valid JSON');
        err.code = 'AI_BAD_JSON';
        err.cause = cause;
        throw err;
      }
      return { parsed, text, usage };
    } catch (err) {
      if (err.name === 'AbortError') {
        lastError = new Error(`Gemini request timed out after ${TIMEOUT_MS}ms`);
        if (attempt < MAX_ATTEMPTS) { await sleep(2 ** attempt * 300); continue; }
        throw lastError;
      }
      if (attempt >= MAX_ATTEMPTS || !isRetryable(err.status)) throw err;
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error('Gemini call failed');
}
