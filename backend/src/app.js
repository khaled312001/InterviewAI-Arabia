// Pure Express application — no app.listen() and no cron.
// Used by both:
//   - src/index.js (local dev / Hostinger Passenger): wraps it with listen + cron
//   - api/index.js (Vercel serverless): wraps it with serverless-http
// Keeping the app construction here means the same routes serve both runtimes.

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { generalLimiter } from './middleware/rateLimit.js';
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

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || env.corsOrigins.includes(origin) || env.corsOrigins.includes('*')) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(morgan(env.isProd ? 'combined' : 'dev', {
    stream: { write: (msg) => logger.http ? logger.http(msg.trim()) : logger.info(msg.trim()) },
  }));

  app.use('/api', generalLimiter);

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'interviewai-arabia',
      runtime: process.env.VERCEL ? 'vercel' : 'node',
      time: new Date().toISOString(),
    });
  });

  // Diagnostic — surfaces which env vars are missing/short without leaking
  // values. Use this to debug 500s and FUNCTION_INVOCATION_FAILED on Vercel.
  app.get('/api/diag', (_req, res) => {
    const present = (k) => Boolean(env[k]);
    const length  = (k) => (env[k] ? String(env[k]).length : 0);
    res.json({
      runtime: process.env.VERCEL ? 'vercel' : 'node',
      nodeEnv: env.NODE_ENV,
      env: {
        DATABASE_URL:   { set: present('DATABASE_URL') },
        JWT_SECRET:     { set: present('JWT_SECRET'), lengthOk: length('JWT_SECRET') >= 32, length: length('JWT_SECRET') },
        GROQ_API_KEY:   { set: present('GROQ_API_KEY'), prefix: env.GROQ_API_KEY?.slice(0, 4) },
        AI_ENABLED:     env.AI_ENABLED,
        AI_PROVIDER:    env.AI_PROVIDER,
        CORS_ORIGINS:   { set: present('CORS_ORIGINS'), count: env.corsOrigins.length },
        ADMIN_EMAIL:    { set: present('ADMIN_EMAIL') },
        ADMIN_PASSWORD: { set: present('ADMIN_PASSWORD'), lengthOk: length('ADMIN_PASSWORD') >= 8 },
        PAYMOB_ENABLED: env.PAYMOB_ENABLED,
        CRON_SECRET:    { set: present('CRON_SECRET') },
      },
      validationErrors: env.validationErrors,
      time: new Date().toISOString(),
    });
  });

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

  // Static / SPA fallback — only meaningful on Hostinger; Vercel serves these
  // directly from the filesystem via its routing layer (see vercel.json).
  if (!process.env.VERCEL) {
    const adminDist = path.resolve(__dirname, '..', 'public', 'admin');
    app.use('/admin', express.static(adminDist));
    app.get('/admin/*', (_req, res) => {
      res.sendFile(path.join(adminDist, 'index.html'), (err) => {
        if (err) res.status(404).send('Admin dashboard not built yet.');
      });
    });

    const webDist = path.resolve(__dirname, '..', 'public', 'web');
    const webIndex = path.join(webDist, 'index.html');
    const webIndexExists = fs.existsSync(webIndex);

    app.use(express.static(webDist, { index: false, fallthrough: true }));

    app.get('/', (req, res, _next) => {
      if (req.accepts(['html', 'json']) === 'json') {
        return res.json({
          app: 'InterviewAI Arabia',
          company: 'شركة برمجلي',
          website: 'https://barmagly.tech',
          admin: '/admin',
          health: '/api/health',
        });
      }
      if (webIndexExists) return res.sendFile(webIndex);
      res.status(404).send('Web app not built. Run `expo export -p web` in mobile/.');
    });

    app.get(/^\/(?!api\/|admin\/?).*/, (req, res, next) => {
      if (req.method !== 'GET') return next();
      if (webIndexExists) return res.sendFile(webIndex);
      next();
    });
  } else {
    // On Vercel, the root JSON metadata only fires if Vercel routing missed
    // (shouldn't happen with our vercel.json but useful as a safety net).
    app.get('/', (_req, res) => {
      res.json({ app: 'InterviewAI Arabia', runtime: 'vercel', api: '/api/health' });
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
