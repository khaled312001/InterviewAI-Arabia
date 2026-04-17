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
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  isProd: parsed.data.NODE_ENV === 'production',
};
