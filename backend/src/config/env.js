import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env from the backend package root regardless of process.cwd().
// Passenger (Hostinger) spawns the Node process with CWD set to the Apache
// document root, not our backend/ dir — so we must anchor to this file.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

// z.coerce.boolean() is surprising: Boolean("false") === true. Custom parser
// correctly reads "true"/"1"/"yes"/"on" as true, everything else as false.
const bool = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string')  return /^(true|1|yes|on)$/i.test(v.trim());
  return false;
}, z.boolean()).default(false);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  // AI provider — default to Groq (free tier, OpenAI-compatible).
  AI_ENABLED: bool,
  AI_PROVIDER: z.enum(['groq', 'openrouter', 'gemini', 'claude']).default('groq'),
  AI_MODEL: z.string().optional().default(''),
  GROQ_API_KEY: z.string().optional().default(''),
  OPENROUTER_API_KEY: z.string().optional().default(''),
  GEMINI_API_KEY: z.string().optional().default(''),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  // Legacy — kept so existing .env files don't break.
  CLAUDE_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  CLAUDE_ENABLED: bool,
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  FREE_DAILY_QUESTION_LIMIT: z.coerce.number().int().positive().default(5),
  ADMIN_EMAIL: z.string().email().default('admin@barmagly.tech'),
  ADMIN_PASSWORD: z.string().min(8).default('ChangeMeImmediately!'),
  GOOGLE_PLAY_PACKAGE_NAME: z.string().default('tech.barmagly.interviewai'),
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: z.string().optional().default(''),
  GOOGLE_PLAY_ENABLED: bool,

  // Paymob (Egypt) — subscription payment gateway
  PAYMOB_ENABLED: bool,
  PAYMOB_API_KEY: z.string().optional().default(''),
  PAYMOB_INTEGRATION_ID: z.string().optional().default(''),
  PAYMOB_IFRAME_ID: z.string().optional().default(''),
  PAYMOB_HMAC_SECRET: z.string().optional().default(''),

  // Cron secret — Vercel Cron sends Authorization: Bearer <CRON_SECRET>.
  // Required on Vercel so the public /api/cron/* endpoints aren't abusable.
  CRON_SECRET: z.string().optional().default(''),
});

// Lenient parse — log validation errors but DO NOT exit. Exiting kills the
// serverless function at module load with FUNCTION_INVOCATION_FAILED and no
// useful error in the logs. With this approach, /api/health and /api/diag
// stay live; only DB-touching routes fail (with clearer 500s).
const parsed = schema.safeParse(process.env);
const validationErrors = parsed.success ? null : parsed.error.flatten().fieldErrors;
if (validationErrors) {
  console.error('Environment validation issues:', JSON.stringify(validationErrors));
}

const safe = (k, fallback) => {
  if (parsed.success) return parsed.data[k];
  const v = process.env[k];
  return v === undefined || v === '' ? fallback : v;
};
const safeBool = (k) => /^(true|1|yes|on)$/i.test(String(safe(k, 'false')));
const safeNum  = (k, fallback) => {
  const v = Number(safe(k, fallback));
  return Number.isFinite(v) ? v : fallback;
};

export const env = {
  NODE_ENV:                safe('NODE_ENV', 'production'),
  PORT:                    safeNum('PORT', 4000),
  DATABASE_URL:            safe('DATABASE_URL', ''),
  JWT_SECRET:              safe('JWT_SECRET', ''),
  JWT_EXPIRES_IN:          safe('JWT_EXPIRES_IN', '7d'),
  JWT_REFRESH_EXPIRES_IN:  safe('JWT_REFRESH_EXPIRES_IN', '30d'),
  AI_ENABLED:              safeBool('AI_ENABLED'),
  AI_PROVIDER:             safe('AI_PROVIDER', 'groq'),
  AI_MODEL:                safe('AI_MODEL', ''),
  GROQ_API_KEY:            safe('GROQ_API_KEY', ''),
  OPENROUTER_API_KEY:      safe('OPENROUTER_API_KEY', ''),
  GEMINI_API_KEY:          safe('GEMINI_API_KEY', ''),
  ANTHROPIC_API_KEY:       safe('ANTHROPIC_API_KEY', ''),
  CLAUDE_MODEL:            safe('CLAUDE_MODEL', 'claude-haiku-4-5-20251001'),
  CLAUDE_ENABLED:          safeBool('CLAUDE_ENABLED'),
  CORS_ORIGINS:            safe('CORS_ORIGINS', '*'),
  FREE_DAILY_QUESTION_LIMIT: safeNum('FREE_DAILY_QUESTION_LIMIT', 5),
  ADMIN_EMAIL:             safe('ADMIN_EMAIL', 'admin@barmagly.tech'),
  ADMIN_PASSWORD:          safe('ADMIN_PASSWORD', 'ChangeMeImmediately!'),
  GOOGLE_PLAY_PACKAGE_NAME: safe('GOOGLE_PLAY_PACKAGE_NAME', 'tech.barmagly.interviewai'),
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: safe('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON', ''),
  GOOGLE_PLAY_ENABLED:     safeBool('GOOGLE_PLAY_ENABLED'),
  PAYMOB_ENABLED:          safeBool('PAYMOB_ENABLED'),
  PAYMOB_API_KEY:          safe('PAYMOB_API_KEY', ''),
  PAYMOB_INTEGRATION_ID:   safe('PAYMOB_INTEGRATION_ID', ''),
  PAYMOB_IFRAME_ID:        safe('PAYMOB_IFRAME_ID', ''),
  PAYMOB_HMAC_SECRET:      safe('PAYMOB_HMAC_SECRET', ''),
  CRON_SECRET:             safe('CRON_SECRET', ''),
  validationErrors,
  get corsOrigins() {
    return this.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  },
  get isProd() { return this.NODE_ENV === 'production'; },
};
