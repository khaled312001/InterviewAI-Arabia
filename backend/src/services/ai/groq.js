/**
 * Groq fallback provider.
 *
 * Kept so the product degrades rather than dies if the Anthropic key is
 * missing, rate-limited, or the account runs dry. It speaks the same
 * `{ parsed, text, usage }` contract as the Claude provider so callers never
 * branch on which vendor answered.
 *
 * Groq's OpenAI-compatible endpoint supports `response_format: json_object`,
 * which guarantees syntactically valid JSON but NOT schema conformance — so
 * the schema is also restated in the prompt, and the result is still shape-
 * checked by the caller. That is strictly weaker than Claude's structured
 * outputs, which is the main reason Claude is the default.
 */

import { env } from '../../config/env.js';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;

export function isConfigured() {
  return Boolean(env.GROQ_API_KEY);
}

/** Retry only on transient failures; a 400 will never succeed on retry. */
function isRetryable(status) {
  return status === 408 || status === 409 || status === 429 || (status >= 500 && status < 600);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function callGroq({
  system,
  systemExtra,
  messages,
  schema,
  maxTokens = 2048,
  model = env.AI_MODEL || 'llama-3.3-70b-versatile',
}) {
  if (!isConfigured()) throw new Error('GROQ_API_KEY is not set');

  const systemText = [
    system,
    systemExtra,
    schema
      ? `\nRespond with a single JSON object only — no prose, no markdown fences — matching exactly this JSON Schema:\n${JSON.stringify(schema)}`
      : '',
  ].filter(Boolean).join('\n\n');

  const body = {
    model,
    messages: [{ role: 'system', content: systemText }, ...messages],
    temperature: 0.3,
    max_tokens: maxTokens,
    ...(schema ? { response_format: { type: 'json_object' } } : {}),
  };

  const started = Date.now();
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // The previous implementation had no timeout at all, so a hung Groq
    // connection held an Express worker until the platform killed it.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        const err = new Error(`Groq HTTP ${res.status}: ${detail}`);
        err.status = res.status;
        if (isRetryable(res.status) && attempt < MAX_ATTEMPTS) {
          lastError = err;
          // Exponential backoff with jitter, honouring Retry-After when given.
          const retryAfter = Number(res.headers.get('retry-after'));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 2 ** attempt * 250 + Math.random() * 250;
          await sleep(wait);
          continue;
        }
        throw err;
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';

      const usage = {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        latencyMs: Date.now() - started,
        model,
      };

      if (!schema) return { text, usage };

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (cause) {
        const err = new Error('Groq returned a response that is not valid JSON');
        err.code = 'AI_BAD_JSON';
        err.cause = cause;
        throw err;
      }
      return { parsed, text, usage };
    } catch (err) {
      if (err.name === 'AbortError') {
        lastError = new Error(`Groq request timed out after ${TIMEOUT_MS}ms`);
        if (attempt < MAX_ATTEMPTS) { await sleep(2 ** attempt * 250); continue; }
        throw lastError;
      }
      if (attempt >= MAX_ATTEMPTS || !isRetryable(err.status)) throw err;
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error('Groq call failed');
}
