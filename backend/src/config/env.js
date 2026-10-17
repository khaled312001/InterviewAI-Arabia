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
  CLAUDE_MODEL: z.string().default('claude-opus-5-5'),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  GROQ_API_KEY: z.string().optional().default(''),

  // Firebase Cloud Messaging. Base64-encoded service-account JSON — the private
  // key is multi-line PEM and a .env line cannot hold a newline. Optional: an
  // unset value means push is off, which every caller already handles.
  FIREBASE_SERVICE_ACCOUNT_B64: z.string().optional().default(''),
  PUSH_ENABLED: z.string().optional().default('true'),
  GEMINI_API_KEY: z.string().optional().default(''),
  AI_MODEL: z.string().optional().default(''),

  /* ------------------------------ Voice ----------------------------- */
  /**
   * Deepgram Voice Agent — the live spoken interview.
   *
   * Unset means the feature is simply absent: /api/voice/session answers 503
   * and the client falls back to the typed interview it has always had. That
   * is the correct behaviour for a deployment without a Deepgram project, and
   * it is why there is no separate VOICE_ENABLED flag to get out of step with
   * whether a key actually exists.
   */
  DEEPGRAM_API_KEY: z.string().optional().default(''),
  /**
   * Which Claude answers on a live call.
   *
   * Empty falls through to CLAUDE_MODEL. It exists as its own setting because
   * the two jobs have opposite priorities: the written evaluation is read
   * minutes later and should be the best model available, while a spoken reply
   * is a silence on a phone call and every hundred milliseconds is audible.
   * Opus 5.5 cannot switch its thinking off, so if the pauses are too long the
   * lever is here — claude-haiku-5-5 and claude-sonnet-5-5 are both markedly
   * faster, and the written evaluation keeps using CLAUDE_MODEL regardless.
   */
  VOICE_LLM_MODEL: z.string().optional().default(''),
  /** Deepgram speak model for English calls. Empty uses flux-kit-en. */
  VOICE_SPEAK_MODEL: z.string().optional().default(''),

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

  // Outbound mail. Empty by default so a deployment without a mailbox starts
  // normally and simply cannot send — `isConfigured()` in services/mail decides
  // that, not a crash at boot.
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().optional().default(465),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  MAIL_FROM: z.string().optional().default(''),

  /**
   * reCAPTCHA v3, guarding the public contact form.
   *
   * All three default to empty/zero so a deployment without keys boots and the
   * form keeps working — services/security/recaptcha.js treats "no secret" as
   * "skip verification", because a missing environment variable must not take
   * down the only channel a locked-out user has. They are declared here so
   * cfg() can fall back to env when the credential row does not exist yet;
   * without the declaration cfg() would read `undefined` and silently disable
   * a captcha the operator believes is on.
   */
  RECAPTCHA_SITE_KEY: z.string().optional().default(''),
  RECAPTCHA_SECRET: z.string().optional().default(''),
  RECAPTCHA_MIN_SCORE: z.string().optional().default(''),

  /**
   * Career platform — job feeds.
   *
   * The public feeds need no key and run whenever JOBS_INGEST_ENABLED is on.
   * JSearch (Google for Jobs: LinkedIn, Indeed, Glassdoor, company sites) and
   * Adzuna are metered and run only once a key is set — from here or from the
   * admin panel (secrets/registry.js). Declared so cfg() has an env fallback.
   */
  JOBS_INGEST_ENABLED: bool(true),
  JSEARCH_API_KEY: z.string().optional().default(''),
  JSEARCH_API_HOST: z.string().optional().default(''),
  ADZUNA_APP_ID: z.string().optional().default(''),
  ADZUNA_APP_KEY: z.string().optional().default(''),
  JOOBLE_API_KEY: z.string().optional().default(''),
  // The desktop app's server, read by the customer dashboard (routes/account.js).
  MEETING_AI_API_URL: z.string().optional().default(''),
  MEETING_AI_INTERNAL_SECRET: z.string().optional().default(''),

  /**
   * Google Calendar / Meet / Tasks (routes/calendar.js).
   *
   * Server-side OAuth web flow, so it needs a client SECRET — unlike Google
   * sign-in, which only verifies ID tokens. The client id is optional here:
   * empty falls back to the web sign-in client id (app_settings
   * `google_client_id_web`), which is a "Web application" client and can
   * carry the extra redirect URI. Both are also settable from the admin panel
   * (secrets/registry.js). With no secret the feature reports
   * `configured:false` and the app hides the connect button.
   *
   * The redirect URI must match one registered on that OAuth client exactly.
   */
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional().default(''),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().default('https://interprova.com/api/calendar/google/callback'),

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
