// Pure Express application — no app.listen(), no cron. src/index.js wraps it.
//
// Serving layout on the single-process Hostinger deploy:
//   /            → landing page      (public/landing)
//   /app, /app/* → Expo web SPA      (public/web)
//   /admin/*     → admin dashboard   (public/admin)
//   /api/*       → this API

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { generalLimiter } from './middleware/rateLimit.js';
import { warmCredentials } from './services/secrets/store.js';
import { warmAppSettings } from './services/appSettings.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import './utils/asyncHandler.js'; // registers BigInt.toJSON

import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import categoryRoutes from './routes/categories.js';
import sessionRoutes from './routes/sessions.js';
import subscriptionRoutes from './routes/subscriptions.js';
import adminRoutes from './routes/admin.js';
import meetingRoutes from './routes/meeting.js';
import ttsRoutes from './routes/tts.js';
import paymentRoutes from './routes/payments.js';
import cronRoutes from './routes/cron.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '..', 'public');

const STATIC_OPTS = {
  // Hashed asset filenames can be cached forever; HTML must not be.
  maxAge: '1y',
  index: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  },
};

export function createApp() {
  const app = express();

  // Admin-managed provider credentials and app settings are read synchronously
  // by request handlers (easykash.isConfigured(), quota's daily limit), so the
  // caches are primed here. Both are best-effort: on failure every accessor
  // falls back to the corresponding env var, which is the pre-existing
  // behaviour, so a slow database at boot degrades rather than breaks.
  void warmCredentials();
  void warmAppSettings();

  // Exactly one proxy hop (LiteSpeed). Setting this to `true` would let a
  // client spoof req.ip via X-Forwarded-For, which is what made the old cron
  // loopback check bypassable from the internet.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({
    // The landing page and the Expo web bundle both need inline styles/scripts;
    // a strict CSP is applied to the API surface only.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    // The web app is same-origin with the API, so this is safe and blocks the
    // referrer leaking auth-bearing URLs to third parties.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: env.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  }));

  app.use(cors({
    origin(origin, cb) {
      // Same-origin and native app requests have no Origin header.
      if (!origin) return cb(null, true);
      if (env.corsOrigins.includes(origin)) return cb(null, true);
      // Never honour '*' together with credentials — that combination is
      // rejected by browsers anyway and only creates false confidence.
      logger.warn('CORS blocked', { origin });
      return cb(null, false);
    },
    credentials: true,
    maxAge: 86400,
  }));

  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Request id for correlating a user-reported error with a log line.
  app.use((req, res, next) => {
    req.id = req.get('x-request-id') || crypto.randomUUID();
    res.setHeader('x-request-id', req.id);
    next();
  });

  morgan.token('rid', (req) => req.id);
  app.use(morgan(
    env.isProd ? ':rid :method :url :status :response-time ms' : 'dev',
    { stream: { write: (m) => logger.info(m.trim()) } },
  ));

  app.use('/api', generalLimiter);

  /* ------------------------------ health ------------------------------ */

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'interviewai-arabia',
      version: process.env.npm_package_version || null,
      time: new Date().toISOString(),
    });
  });

  /**
   * Diagnostics. Previously public, which told an attacker exactly which
   * secrets were configured and leaked the first four characters of the AI
   * key. Now off unless explicitly enabled, and token-gated when on.
   */
  app.get('/api/diag', (req, res) => {
    if (!env.DIAG_ENABLED) return res.status(404).json({ error: 'Not found' });
    const provided = req.get('x-diag-token') || req.query.token;
    if (!env.DIAG_TOKEN || provided !== env.DIAG_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const set = (v) => Boolean(v);
    res.json({
      nodeEnv: env.NODE_ENV,
      env: {
        DATABASE_URL: { set: set(env.DATABASE_URL) },
        JWT_SECRET: { set: set(env.JWT_SECRET), lengthOk: (env.JWT_SECRET || '').length >= 32 },
        AI_ENABLED: env.AI_ENABLED,
        AI_PROVIDER: env.AI_PROVIDER,
        CLAUDE_MODEL: env.CLAUDE_MODEL,
        ANTHROPIC_API_KEY: { set: set(env.ANTHROPIC_API_KEY) },
        EASYKASH_ENABLED: env.EASYKASH_ENABLED,
        EASYKASH_MOCK: env.EASYKASH_MOCK,
        EASYKASH_WEBHOOK_SECRET: { set: set(env.EASYKASH_WEBHOOK_SECRET) },
        CORS_ORIGINS: { count: env.corsOrigins.length },
        CRON_SECRET: { set: set(env.CRON_SECRET) },
      },
      time: new Date().toISOString(),
    });
  });

  /* ------------------------------ API --------------------------------- */

  app.use('/api/auth', authRoutes);
  app.use('/api/user', userRoutes);
  app.use('/api/categories', categoryRoutes);
  app.use('/api/sessions', sessionRoutes);
  app.use('/api/subscriptions', subscriptionRoutes);
  app.use('/api/meeting', meetingRoutes);
  app.use('/api/tts', ttsRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/cron', cronRoutes);

  // Anything else under /api is a 404 as JSON — never fall through to the SPA
  // shell, which would return 200 + HTML to a broken API call and make client
  // debugging needlessly confusing.
  app.use('/api', notFound);

  /* ---------------------------- frontends ------------------------------ */

  const landingDir = path.join(PUBLIC, 'landing');
  const adminDir = path.join(PUBLIC, 'admin');
  const webDir = path.join(PUBLIC, 'web');

  const landingIndex = path.join(landingDir, 'index.html');
  const adminIndex = path.join(adminDir, 'index.html');
  const webIndex = path.join(webDir, 'index.html');

  const has = (p) => { try { return fs.existsSync(p); } catch { return false; } };

  // --- admin dashboard ---
  app.use('/admin', express.static(adminDir, STATIC_OPTS));
  app.get(/^\/admin(\/.*)?$/, (_req, res, next) => {
    if (!has(adminIndex)) return next();
    res.sendFile(adminIndex);
  });

  // --- Expo web app ---
  // Expo emits absolute /_expo/** and /assets/** URLs, so those must resolve
  // from the web bundle regardless of the /app prefix the SPA is mounted at.
  app.use('/_expo', express.static(path.join(webDir, '_expo'), STATIC_OPTS));
  app.use('/assets', express.static(path.join(webDir, 'assets'), STATIC_OPTS));
  app.use('/app', express.static(webDir, STATIC_OPTS));
  app.get(/^\/app(\/.*)?$/, (_req, res, next) => {
    if (!has(webIndex)) return next();
    res.sendFile(webIndex);
  });

  // --- landing page ---
  app.use('/', express.static(landingDir, STATIC_OPTS));
  app.get('/', (req, res, next) => {
    if (req.accepts(['html', 'json']) === 'json') {
      return res.json({
        app: 'Interprova',
        api: '/api/health',
        web: '/app',
        admin: '/admin',
      });
    }
    if (has(landingIndex)) return res.sendFile(landingIndex);
    next();
  });

  // Marketing routes the landing page links to. Served from the landing
  // bundle when present so /privacy and /terms are real URLs (Google Play and
  // EasyKash both require reachable policy pages).
  for (const page of ['privacy', 'terms', 'delete-account']) {
    app.get(`/${page}`, (_req, res, next) => {
      const file = path.join(landingDir, `${page}.html`);
      if (has(file)) return res.sendFile(file);
      next();
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
