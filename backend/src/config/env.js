import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// Passenger spawns the process with CWD set to the Apache document root, not
// our package root, so anchor .env resolution to this file.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

/**
 * `z.coerce.boolean()` is a trap: Boolean("false") === true, so every
 * "FEATURE=false" would read as enabled. Parse the string properly.
 */
const bool = (def = false) =>
  z.preprocess((v) => {
    if (typeof v === 'boolean') return v;
    if (v === undefined || v === '') return def;
    return /^(true|1|yes|on)$/i.test(String(v).trim());
  }, z.boolean());

const csv = (def = []) =>
  z.preprocess((v) => {
    if (Array.isArray(v)) return v;
    if (v === undefined || v === '') return def;
    return String(v).split(',').map((s) => s.trim()).filter(Boolean);
  }, z.array(z.string()));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  /** Public origin of the deployed app — used to build payment redirect URLs. */
  APP_URL: z.string().url().default('http://localhost:4000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  /* ------------------------------- AI ------------------------------- */
  AI_ENABLED: bool(false),
  AI_PROVIDER: z.enum(['claude', 'gemini', 'groq']).default('claude'),
  /**
   * Default model. Opus 5 gives the best Arabic evaluation quality; if the
   * per-answer cost matters more than the last few points of quality, this is
   * the single knob to turn (claude-sonnet-5 is ~40% of the cost,
   * claude-haiku-4-5 ~20%). Cost per call is recorded in claude_api_logs, so
   * measure before switching.
   */
  CLAUDE_MODEL: z.string().default('claude-opus-5'),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  GROQ_API_KEY: z.string().optional().default(''),

  // Firebase Cloud Messaging. Base64-encoded service-account JSON — the private
  // key is multi-line PEM and a .env line cannot hold a newline. Optional: an
  // unset value means push is off, which every caller already handles.
  FIREBASE_SERVICE_ACCOUNT_B64: z.string().optional().default(''),
  PUSH_ENABLED: z.string().optional().default('true'),
  GEMINI_API_KEY: z.string().optional().default(''),
  AI_MODEL: z.string().optional().default(''),

  /* ---------------------------- EasyKash ---------------------------- */
  EASYKASH_ENABLED: bool(false),
  /** Runs the full payment flow locally with no gateway and no real money. */
  EASYKASH_MOCK: bool(false),
  EASYKASH_BASE_URL: z.string().default('https://back.easykash.net'),
  EASYKASH_PAY_PATH: z.string().default('/api/directpayv1/pay'),
  EASYKASH_API_KEY: z.string().optional().default(''),
  EASYKASH_WEBHOOK_SECRET: z.string().optional().default(''),
  EASYKASH_SIGNATURE_HEADER: z.string().optional().default(''),
  EASYKASH_SIGNATURE_ALGO: z.string().default('sha256'),
  /** Ordered field list concatenated to build the webhook signature. */
  EASYKASH_SIGNATURE_FIELDS: csv([
    'Amount', 'PaymentMethod', 'ProductCode', 'easykashRef', 'customerReference', 'status',
  ]),
  EASYKASH_PAYMENT_OPTIONS: csv(['CARD', 'FAWRY', 'WALLET']),

  /* ----------------------------- misc ------------------------------- */
  CORS_ORIGINS: csv(['http://localhost:5173', 'http://localhost:8081']),
  FREE_DAILY_QUESTION_LIMIT: z.coerce.number().int().positive().default(5),

  ADMIN_EMAIL: z.string().email().default('admin@barmagly.tech'),
  ADMIN_PASSWORD: z.string().min(8).default('ChangeMeImmediately!'),

  CRON_SECRET: z.string().optional().default(''),

  /**
   * Master key for the AES-256-GCM envelope over `provider_credentials`.
   * Optional: it falls back to JWT_SECRET so the integrations pages work on a
   * deployment that has not set it. Set it in production — otherwise rotating
   * JWT_SECRET silently makes every stored provider key undecryptable.
   */
  CREDENTIALS_SECRET: z.string().optional().default(''),

  /** Expose /api/diag. Off by default — it reveals which secrets are set. */
  DIAG_ENABLED: bool(false),
  DIAG_TOKEN: z.string().optional().default(''),
});

const parsed = schema.safeParse(process.env);

/**
 * Fail fast in production.
 *
 * The previous version deliberately downgraded every validation error to a
 * console warning so the serverless function would still boot. On a
 * persistent Hostinger process that trade-off is all downside: it let the app
 * run with a 6-character JWT_SECRET and a wide-open CORS fallback, and the
 * only signal was a line in a log nobody reads. Booting with a broken security
 * config is worse than not booting.
 */
if (!parsed.success) {
  const errors = parsed.error.flatten().fieldErrors;
  const isProd = process.env.NODE_ENV === 'production';
  const message = `Environment validation failed:\n${JSON.stringify(errors, null, 2)}`;

  if (isProd) {
    console.error(message);
    console.error('Refusing to start with an invalid production configuration.');
    process.exit(1);
  }
  console.warn(message);
}

const data = parsed.success ? parsed.data : schema.partial().parse(process.env);

export const env = {
  ...data,
  validationErrors: parsed.success ? null : parsed.error.flatten().fieldErrors,
  get corsOrigins() { return this.CORS_ORIGINS; },
  get isProd() { return this.NODE_ENV === 'production'; },
};

/**
 * THE MOCK GATEWAY CANNOT RUN IN PRODUCTION. Not "should not" — cannot.
 *
 * Mock mode mounts an endpoint that credits real minutes against a real user
 * for a reference and nothing else, and it is reachable whenever this flag is
 * truthy. Turning payments on is meant to be a configuration change, which
 * means one wrong line in a .env file — or a staging deploy pointed at the
 * production database — was all that stood between that minter and live
 * customers. A warning in a log nobody reads is not a control; refusing to
 * honour the flag is.
 *
 * Left as a hard override rather than a boot failure so that discovering the
 * misconfiguration does not take the whole API down with it: real payments,
 * and every other route, keep working.
 */
if (env.isProd && env.EASYKASH_MOCK) {
  console.error('[SECURITY] EASYKASH_MOCK is set in production and has been IGNORED — the mock checkout mints minutes for free and is disabled outside development.');
  env.EASYKASH_MOCK = false;
}

/**
 * Loud warnings for configurations that are legal but dangerous. These do not
 * stop the boot, but they are the things that quietly lose money.
 */
if (env.isProd) {
  if (env.EASYKASH_ENABLED && !env.EASYKASH_WEBHOOK_SECRET) {
    console.error('[SECURITY] EasyKash is enabled without EASYKASH_WEBHOOK_SECRET — callbacks cannot be verified and will be rejected.');
  }
  if (env.ADMIN_PASSWORD === 'ChangeMeImmediately!') {
    console.error('[SECURITY] ADMIN_PASSWORD is still the default value.');
  }
  if (env.corsOrigins.includes('*')) {
    console.error('[SECURITY] CORS_ORIGINS contains "*" — any site can call this API with credentials.');
  }
  if (!env.CRON_SECRET) {
    console.warn('[WARN] CRON_SECRET is empty — the HTTP cron routes will reject every request.');
  }
}
