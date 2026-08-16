/**
 * Model pricing + cost accounting.
 *
 * Every AI call is logged with a cost so the admin dashboard can answer the
 * only question that matters for a paid product: what does one user cost us
 * per month, and is the subscription price above that? The previous build
 * logged raw token counts with no price attached, which cannot answer it.
 *
 * Costs are tracked in **micro-USD integers** (1e-6 USD). Money never touches
 * a float.
 */

/** USD per 1M tokens, as published on platform.claude.com (cached 2026-06-24). */
const CLAUDE_PRICES = {
  'claude-opus-5':    { input: 5.00,  output: 25.00 },
  'claude-opus-4-8':  { input: 5.00,  output: 25.00 },
  'claude-opus-4-7':  { input: 5.00,  output: 25.00 },
  'claude-sonnet-5':  { input: 3.00,  output: 15.00 },
  'claude-sonnet-4-6':{ input: 3.00,  output: 15.00 },
  'claude-haiku-4-5': { input: 1.00,  output: 5.00  },
  'claude-fable-5':   { input: 10.00, output: 50.00 },
};

/** Groq's hosted Llama tiers, for the fallback provider. */
const GROQ_PRICES = {
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'llama-3.1-8b-instant':    { input: 0.05, output: 0.08 },
};

/**
 * Gemini free tier bills nothing. Paid rates are listed so that flipping to a
 * paid key later reports real numbers instead of silently showing $0 margin.
 */
const GEMINI_PRICES = {
  'gemini-flash-latest':   { input: 0.30, output: 2.50 },
  'gemini-2.0-flash':      { input: 0.10, output: 0.40 },
  'gemini-2.5-flash':      { input: 0.30, output: 2.50 },
  'gemini-1.5-flash':      { input: 0.075, output: 0.30 },
};

const DEFAULT_PRICE = { input: 5.00, output: 25.00 };

/**
 * Prompt-cache multipliers (Claude only).
 * Reads are ~0.1x the base input rate; 5-minute writes are 1.25x.
 */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export function priceFor(provider, model) {
  if (provider === 'groq') return GROQ_PRICES[model] || { input: 0.59, output: 0.79 };
  if (provider === 'gemini') {
    const k = Object.keys(GEMINI_PRICES).find((x) => model?.startsWith(x));
    return GEMINI_PRICES[k] || { input: 0.10, output: 0.40 };
  }
  // Strip any accidental date suffix so `claude-opus-5-20260101` still prices.
  const key = Object.keys(CLAUDE_PRICES).find((k) => model?.startsWith(k));
  return CLAUDE_PRICES[key] || DEFAULT_PRICE;
}

/**
 * @returns {number} cost in micro-USD, rounded to the nearest integer.
 */
export function costMicroUsd({
  provider = 'claude',
  model,
  inputTokens = 0,
  outputTokens = 0,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
}) {
  const p = priceFor(provider, model);

  // usage.input_tokens from the Anthropic API already EXCLUDES cached tokens,
  // so the three input buckets are additive rather than overlapping. Adding
  // them without this understanding is the classic way to double-count cache
  // reads and report a cost far above the invoice.
  const usd =
    (inputTokens      / 1_000_000) * p.input +
    (outputTokens     / 1_000_000) * p.output +
    (cacheReadTokens  / 1_000_000) * p.input * CACHE_READ_MULTIPLIER +
    (cacheWriteTokens / 1_000_000) * p.input * CACHE_WRITE_MULTIPLIER;

  return Math.round(usd * 1_000_000);
}

export function formatUsd(microUsd) {
  return `$${(microUsd / 1_000_000).toFixed(4)}`;
}
