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
import { startCronJobs } from './services/cron.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'interviewai-arabia', time: new Date().toISOString() });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/admin', adminRoutes);

// Serve built admin SPA (copied here by deploy.sh)
const adminDist = path.resolve(__dirname, '..', 'public', 'admin');
app.use('/admin', express.static(adminDist));
app.get('/admin/*', (_req, res) => {
  res.sendFile(path.join(adminDist, 'index.html'), (err) => {
    if (err) res.status(404).send('Admin dashboard not built yet. Run scripts/deploy.sh.');
  });
});

// Serve Expo-web user app (built from /mobile via `expo export --platform web`).
// Static assets first; for any unmatched non-API GET, fall through to index.html
// so client-side navigation works (SPA mode).
const webDist = path.resolve(__dirname, '..', 'public', 'web');
const webIndex = path.join(webDist, 'index.html');
app.use(express.static(webDist, { index: false, fallthrough: true }));

const webIndexExists = fs.existsSync(webIndex);

app.get('/', (req, res, next) => {
  // API clients asking for JSON explicitly get the metadata.
  if (req.accepts(['html', 'json']) === 'json') {
    return res.json({
      app: 'InterviewAI Arabia',
      company: 'شركة برمجلي',
      website: 'https://barmagly.tech',
      admin: '/admin',
      health: '/api/health',
    });
  }
  // Browsers get the Expo-web user app if it's built.
  if (webIndexExists) return res.sendFile(webIndex);
  res.type('html').send(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>InterviewAI Arabia</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;font-family:'Cairo',system-ui,sans-serif;color:#fff;
      background:linear-gradient(135deg,#0F5AA8 0%,#0A3F75 60%,#081E3A 100%);display:flex;align-items:center;justify-content:center;padding:24px}
    .wrap{max-width:760px;width:100%}
    .logo{display:flex;align-items:center;gap:14px;margin-bottom:28px}
    .logo .mark{width:56px;height:56px;border-radius:14px;background:#fff;color:#0A3F75;
      display:grid;place-items:center;font-weight:800;font-size:26px}
    h1{font-size:34px;margin:0 0 6px;font-weight:800}
    .tagline{color:#D7E3F5;margin:0 0 32px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:28px}
    .card{background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.14);
      border-radius:14px;padding:18px 18px 16px;text-decoration:none;color:#fff;transition:.15s}
    .card:hover{background:rgba(255,255,255,0.14);transform:translateY(-2px)}
    .card .label{color:#BFD2EA;font-size:12px;margin-bottom:6px}
    .card .title{font-weight:700;font-size:18px;margin-bottom:4px}
    .card .desc{color:#D7E3F5;font-size:13px;line-height:1.6}
    footer{color:#A9BEDC;font-size:13px;border-top:1px solid rgba(255,255,255,0.12);padding-top:18px}
    code{background:rgba(0,0,0,0.3);padding:2px 8px;border-radius:6px;font-size:12px}
    a{color:#F39C12}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="logo">
      <div class="mark">A</div>
      <div>
        <h1>InterviewAI Arabia</h1>
        <p class="tagline">مدرّب المقابلات الوظيفية بالذكاء الاصطناعي</p>
      </div>
    </div>

    <div class="grid">
      <a class="card" href="/admin/">
        <div class="label">للمشرفين</div>
        <div class="title">لوحة التحكم</div>
        <div class="desc">إدارة المستخدمين، الأسئلة، الاشتراكات، والتحليلات.</div>
      </a>
      <a class="card" href="/api/health">
        <div class="label">للمطوّرين</div>
        <div class="title">حالة الخادم</div>
        <div class="desc">فحص صحة الـ API والاتصال بقاعدة البيانات.</div>
      </a>
      <a class="card" href="/api/categories">
        <div class="label">REST API</div>
        <div class="title">الأقسام المتاحة</div>
        <div class="desc">قائمة فئات المقابلات (برمجة، محاسبة، تسويق، ...)</div>
      </a>
      <a class="card" href="https://barmagly.tech" target="_blank" rel="noopener">
        <div class="label">الشركة</div>
        <div class="title">شركة برمجلي</div>
        <div class="desc">barmagly.tech · 01010254819</div>
      </a>
    </div>

    <footer>
      هذا الرابط هو الـ <strong>Backend API</strong> للتطبيق. المستخدمون يتفاعلون مع التطبيق عبر نسخة أندرويد (APK). للوصول للواجهة الإدارية اضغط على <a href="/admin/">/admin</a>.
      <br/><br/>
      <code>GET /api/health</code> ·
      <code>POST /api/auth/login</code> ·
      <code>GET /api/categories</code> ·
      <code>POST /api/sessions/start</code>
    </footer>
  </div>
</body>
</html>`);
});

// SPA fallback: any non-API GET with no static match returns the web app shell
// so client-side React Navigation can handle the route.
app.get(/^\/(?!api\/|admin\/?).*/, (req, res, next) => {
  if (req.method !== 'GET') return next();
  if (webIndexExists) return res.sendFile(webIndex);
  next();
});

app.use(notFound);
app.use(errorHandler);

const port = env.PORT;
app.listen(port, () => {
  logger.info(`InterviewAI Arabia backend listening on :${port} (${env.NODE_ENV})`);
  startCronJobs();
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { message: err.message, stack: err.stack });
});
