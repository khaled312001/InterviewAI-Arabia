/**
 * Anthropic Claude provider.
 *
 * Notes on the API surface, because several habits from the old Groq code are
 * outright errors here:
 *
 * - `temperature` / `top_p` / `top_k` are REMOVED on Claude Opus 5 and return
 *   HTTP 400. The old code sent `temperature: 0.4` on every call.
 * - Thinking is ON by default on Opus 5, and `max_tokens` caps thinking plus
 *   response text together. A `max_tokens` sized for just the JSON body will
 *   truncate mid-answer, so the budgets here are deliberately generous.
 * - Structured outputs (`output_config.format`) constrain the response to a
 *   JSON schema at decode time. That replaces the previous `extractJson()`
 *   brace-scraping, which silently produced a fabricated score whenever the
 *   model wrapped its JSON in prose.
 */

import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';
import { cfg } from '../secrets/store.js';
import { logger } from '../../utils/logger.js';

let client = null;

function getClient() {
  if (client) return client;
  if (!cfg('ANTHROPIC_API_KEY')) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }
  client = new Anthropic({
    apiKey: cfg('ANTHROPIC_API_KEY'),
    // The SDK retries 408/409/429/5xx and connection errors with exponential
    // backoff. The old fetch() calls had no retry at all, so a single 529
    // (Anthropic overloaded) surfaced to the user as a failed interview.
    maxRetries: 3,
    // Milliseconds in the TypeScript/JS SDK. Wall-clock worst case is
    // timeout × (maxRetries + 1), which is why this is not set higher.
    timeout: 60_000,
  });
  return client;
}

export function isConfigured() {
  return Boolean(cfg('ANTHROPIC_API_KEY'));
}

/**
 * Single entry point for every Claude call.
 *
 * @param {object}   opts
 * @param {string}   opts.system        Stable system prompt (gets the cache breakpoint).
 * @param {string}  [opts.systemExtra]  Request-specific system text, appended AFTER the
 *                                      cache breakpoint so it never invalidates the prefix.
 * @param {Array}    opts.messages      Anthropic message array.
 * @param {object}  [opts.schema]       JSON Schema — enables structured outputs.
 * @param {number}  [opts.maxTokens]
 * @param {string}  [opts.effort]       'low' | 'medium' | 'high' | 'xhigh' | 'max'
 * @param {string}  [opts.model]
 */
export async function callClaude({
  system,
  systemExtra,
  messages,
  schema,
  maxTokens = 4096,
  effort = 'low',
  model = cfg('CLAUDE_MODEL'),
}) {
  const anthropic = getClient();

  // System is an array of blocks so the stable prefix can carry a cache
  // breakpoint while volatile per-request context sits after it. Anything
  // placed before the breakpoint that changes per request (a timestamp, a
  // user id) would invalidate the cache on every single call.
  const systemBlocks = [
    { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
  ];
  if (systemExtra) systemBlocks.push({ type: 'text', text: systemExtra });

  const request = {
    model,
    max_tokens: maxTokens,
    system: systemBlocks,
    messages,
    // Adaptive thinking at low effort: enough reasoning for a consistent
    // rubric application, without paying for deliberation on a bounded task.
    thinking: { type: 'adaptive' },
    output_config: {
      effort,
      ...(schema ? { format: { type: 'json_schema', schema } } : {}),
    },
  };

  const started = Date.now();
  const response = await anthropic.messages.create(request);

  // Safety classifiers can decline with HTTP 200 + stop_reason 'refusal'.
  // Reading content[0] unconditionally would throw here.
  if (response.stop_reason === 'refusal') {
    const category = response.stop_details?.category ?? 'unknown';
    logger.warn('Claude refused the request', { category, model });
    const err = new Error(`Claude refused this request (${category})`);
    err.code = 'AI_REFUSED';
    throw err;
  }

  if (response.stop_reason === 'max_tokens') {
    // With structured outputs a truncated response is not valid JSON, so this
    // must be loud rather than silently parsed into a partial object.
    const err = new Error('Claude response hit max_tokens before completing');
    err.code = 'AI_TRUNCATED';
    throw err;
  }

  const textBlocks = (response.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const usage = {
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
    cacheReadTokens: response.usage?.cache_read_input_tokens || 0,
    cacheWriteTokens: response.usage?.cache_creation_input_tokens || 0,
    latencyMs: Date.now() - started,
    model: response.model || model,
  };

  if (!schema) return { text: textBlocks, usage };

  // Guaranteed-valid JSON when structured outputs are active. The try/catch
  // exists for the case where the schema was rejected and the request silently
  // fell back to free-form text — better a clear error than a fake result.
  let parsed;
  try {
    parsed = JSON.parse(textBlocks);
  } catch (cause) {
    const err = new Error('Claude returned a response that is not valid JSON');
    err.code = 'AI_BAD_JSON';
    err.cause = cause;
    err.sample = textBlocks.slice(0, 300);
    throw err;
  }

  return { parsed, text: textBlocks, usage };
}
