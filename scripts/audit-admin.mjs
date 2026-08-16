/**
 * Renders the built admin dashboard in a real browser and audits every route.
 *
 * The live backend is not reachable from this machine with valid admin
 * credentials, so every /api/admin/* request is answered by an in-process mock
 * whose shapes are copied from the TypeScript response interfaces in
 * admin/src/features/(*)/api.ts. That exercises the real render path (RTL,
 * theme, grids, charts, layout) without inventing anything about production
 * data.
 *
 *   node scripts/audit-admin.mjs
 *
 * Output: PNGs + report.json under scripts/.out/admin-audit/
 */

import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(ROOT, 'admin', 'dist');
const OUT = process.env.OUT_DIR || path.join(HERE, '.out', 'admin-audit');
const EDGE =
  process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = Number(process.env.PORT || 5199);
const VW = Number(process.env.VW || 1440);
const VH = Number(process.env.VH || 900);

fs.mkdirSync(OUT, { recursive: true });

/* ------------------------------ static server ----------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(url.pathname);
  if (p === '/admin') {
    res.writeHead(302, { Location: '/admin/' });
    return res.end();
  }
  if (!p.startsWith('/admin/')) {
    res.writeHead(404).end('not found');
    return;
  }
  const rel = p.slice('/admin/'.length);
  const file = path.join(DIST, rel);
  if (rel && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    return res.end(fs.readFileSync(file));
  }
  // SPA fallback
  res.writeHead(200, { 'Content-Type': MIME['.html'] });
  res.end(fs.readFileSync(path.join(DIST, 'index.html')));
});

await new Promise((r) => server.listen(PORT, r));

/* -------------------------------- mock API -------------------------------- */

const iso = (dAgo = 0) => new Date(Date.now() - dAgo * 86400000).toISOString();
const day = (i) => new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10);

const ADMIN = {
  id: 'adm_1',
  email: 'super@thiqty.app',
  name: 'خالد أحمد',
  role: 'super_admin',
};

const RANGE = { from: day(0), to: day(29), days: 30, timezone: 'Africa/Cairo', exactTimezone: false };

const CATS = [
  { id: 1, nameAr: 'الهندسة البرمجية', nameEn: 'Software Engineering', icon: '💻', isPremium: false },
  { id: 2, nameAr: 'التسويق الرقمي', nameEn: 'Digital Marketing', icon: '📈', isPremium: true },
  { id: 3, nameAr: 'الموارد البشرية', nameEn: 'Human Resources', icon: '🧑‍💼', isPremium: false },
  { id: 4, nameAr: 'المبيعات', nameEn: 'Sales', icon: '🤝', isPremium: true },
  { id: 5, nameAr: 'المحاسبة والمالية', nameEn: 'Accounting & Finance', icon: '🧾', isPremium: false },
];

const USERS = Array.from({ length: 20 }, (_, i) => ({
  id: `usr_${String(i + 1).padStart(4, '0')}`,
  email: `candidate${i + 1}@example.com`,
  name: ['أحمد محمد', 'سارة عبد الله', 'محمود حسن', 'نور الهدى إبراهيم', 'يوسف السيد'][i % 5],
  phone: i % 3 === 0 ? `+2010${String(10000000 + i)}` : null,
  language: i % 4 === 0 ? 'en' : 'ar',
  plan: i % 3 === 0 ? 'premium' : 'free',
  dailyQuestionsUsed: i % 6,
  lastResetDate: iso(0),
  premiumUntil: i % 3 === 0 ? iso(-30) : null,
  isDisabled: i === 7,
  emailVerifiedAt: i % 5 === 0 ? null : iso(20),
  lastLoginAt: iso(i % 9),
  createdAt: iso(60 - i),
}));

const QUESTIONS = Array.from({ length: 15 }, (_, i) => ({
  id: String(1000 + i),
  categoryId: CATS[i % CATS.length].id,
  questionAr: 'احكِ لي عن موقف واجهت فيه خلافًا مع زميل في العمل وكيف تعاملت معه بشكل احترافي؟',
  questionEn: 'Tell me about a time you disagreed with a colleague and how you handled it.',
  difficulty: ['easy', 'medium', 'hard'][i % 3],
  usageCount: 40 - i,
  isActive: i !== 4,
  createdAt: iso(30 - i),
  category: CATS[i % CATS.length],
}));

function mockFor(pathname, search) {
  const q = new URLSearchParams(search);
  const limit = Number(q.get('limit') || 25);

  if (pathname.endsWith('/admin/auth/me')) return { admin: ADMIN };
  if (pathname.endsWith('/admin/auth/login')) return { token: 'mock.jwt.token', admin: ADMIN };

  if (pathname.endsWith('/analytics/overview'))
    return {
      range: RANGE,
      totals: { users: 12480, premiumUsers: 1342, premiumExpired: 214, conversionRate: 0.1075 },
      current: {
        newUsers: 812,
        sessions: 3411,
        answers: 18422,
        activeUsers: 2140,
        avgScore: 71.4,
        scoredAnswers: 17980,
      },
      previous: { newUsers: 655, sessions: 2988, answers: 15110, activeUsers: 1902 },
      today: { date: day(29), newUsers: 41, sessions: 133, activeUsers: 96 },
    };

  if (pathname.endsWith('/analytics/popular-categories'))
    return {
      range: RANGE,
      limit: 5,
      rows: CATS.map((c, i) => ({
        category: c,
        sessions: 900 - i * 140,
        users: 610 - i * 90,
        scoredAnswers: 4200 - i * 600,
        avgScore: i === 4 ? null : 78 - i * 3.5,
      })),
    };

  if (pathname.endsWith('/analytics/timeseries'))
    return {
      range: RANGE,
      points: Array.from({ length: 30 }, (_, i) => ({
        date: day(i),
        signups: 20 + Math.round(18 * Math.sin(i / 3) + i),
        sessions: 90 + Math.round(40 * Math.sin(i / 4) + i * 2),
        activeUsers: 60 + Math.round(25 * Math.cos(i / 5) + i),
        answers: 400 + Math.round(120 * Math.sin(i / 2) + i * 6),
        avgScore: i % 7 === 0 ? null : 65 + (i % 11),
      })),
    };

  if (pathname.endsWith('/analytics/attention'))
    return {
      attention: { unresolvedReports: 7, failedAiCalls24h: 3, expiringSubscriptions7d: 22 },
      checkedAt: iso(0),
    };

  if (/\/admin\/users\/[^/]+\/sessions$/.test(pathname))
    return {
      sessions: Array.from({ length: 6 }, (_, i) => ({
        id: `ses_${i}`,
        kind: i % 2 ? 'meeting' : 'practice',
        totalScore: 320 + i * 17,
        startedAt: iso(i + 1),
        endedAt: i === 5 ? null : iso(i + 1),
        categoryId: CATS[i % CATS.length].id,
        category: CATS[i % CATS.length],
        answersCount: 4 + (i % 3),
      })),
      total: 6,
    };

  if (/\/admin\/users\/[^/]+$/.test(pathname))
    return {
      user: USERS[0],
      stats: {
        sessionsCount: 24,
        completedCount: 19,
        answersCount: 132,
        avgScore: 74.2,
        lastSessionAt: iso(2),
        subscriptionsCount: 2,
      },
    };

  if (pathname.endsWith('/admin/users'))
    return { users: USERS.slice(0, limit), page: 1, limit, total: USERS.length };

  if (pathname.endsWith('/admin/categories'))
    return {
      categories: CATS.map((c, i) => ({
        ...c,
        descriptionAr: 'أسئلة مقابلات مخصّصة لهذا المجال مع تقييم فوري بالذكاء الاصطناعي.',
        descriptionEn: 'Interview questions for this track.',
        isActive: i !== 3,
        sortOrder: i + 1,
        createdAt: iso(90 - i),
        questionCount: 40 - i * 6,
        sessionCount: 300 - i * 40,
      })),
    };

  if (pathname.endsWith('/admin/questions'))
    return { questions: QUESTIONS.slice(0, limit), total: QUESTIONS.length };

  if (pathname.endsWith('/admin/subscriptions'))
    return {
      subscriptions: Array.from({ length: 12 }, (_, i) => ({
        id: `sub_${i}`,
        userId: USERS[i % USERS.length].id,
        provider: 'easykash',
        providerRef: `EK-${100000 + i}`,
        planCode: i % 2 ? 'monthly' : 'yearly',
        status: ['active', 'pending', 'cancelled', 'expired', 'refunded'][i % 5],
        autoRenew: i % 2 === 0,
        startedAt: iso(40 - i),
        expiresAt: iso(-(20 - i)),
        cancelledAt: i % 5 === 2 ? iso(3) : null,
        createdAt: iso(40 - i),
        user: {
          id: USERS[i % USERS.length].id,
          email: USERS[i % USERS.length].email,
          name: USERS[i % USERS.length].name,
          plan: 'premium',
          premiumUntil: iso(-20),
        },
      })),
      page: 1,
      limit,
      total: 12,
      summary: {
        byStatus: { active: 5, pending: 2, cancelled: 2, expired: 2, refunded: 1 },
        total: 12,
        expiringIn7Days: 3,
      },
    };

  if (pathname.endsWith('/admin/payments'))
    return {
      payments: Array.from({ length: 12 }, (_, i) => ({
        id: `pay_${i}`,
        userId: USERS[i % USERS.length].id,
        subscriptionId: `sub_${i}`,
        provider: 'easykash',
        reference: `THQ-2026-000${100 + i}`,
        providerTxnId: `EK${9000000 + i}`,
        planCode: i % 2 ? 'monthly' : 'yearly',
        amountCents: i % 2 ? 19900 : 179900,
        currency: 'EGP',
        status: ['paid', 'pending', 'failed', 'refunded'][i % 4],
        method: ['card', 'wallet', 'fawry'][i % 3],
        failureReason: i % 4 === 2 ? 'insufficient_funds' : null,
        paidAt: i % 4 === 0 ? iso(i) : null,
        refundedAt: i % 4 === 3 ? iso(i) : null,
        createdAt: iso(i),
        user: { id: USERS[i % USERS.length].id, email: USERS[i % USERS.length].email, name: USERS[i % USERS.length].name },
      })),
      page: 1,
      limit,
      total: 12,
      summary: {
        byStatus: {
          paid: { count: 3, amountMinor: 399700 },
          pending: { count: 3, amountMinor: 59700 },
          failed: { count: 3, amountMinor: 59700 },
          refunded: { count: 3, amountMinor: 179900 },
        },
        paidMinor: 399700,
        paidCount: 3,
        refundedMinor: 179900,
        refundedCount: 3,
        netMinor: 219800,
        currencies: ['EGP'],
      },
    };

  if (pathname.endsWith('/admin/ai-usage')) {
    const bucket = (o) => ({ calls: 0, failures: 0, costMicroUsd: 0, inputTokens: 0, outputTokens: 0, unpricedCalls: 0, ...o });
    return {
      logs: Array.from({ length: 15 }, (_, i) => ({
        id: `log_${i}`,
        userId: i % 4 === 0 ? null : USERS[i % USERS.length].id,
        provider: ['anthropic', 'gemini', 'groq'][i % 3],
        model: ['claude-sonnet-4-6', 'gemini-2.0-flash', 'llama-3.3-70b'][i % 3],
        feature: ['evaluate', 'meeting_turn', 'interview_eval', 'cv_summary'][i % 4],
        inputTokens: 1200 + i * 40,
        outputTokens: 300 + i * 12,
        cacheReadTokens: i * 100,
        cacheWriteTokens: i * 20,
        costMicroUsd: i % 5 === 0 ? null : 4200 + i * 130,
        latencyMs: 800 + i * 55,
        success: i % 6 !== 0,
        errorMessage: i % 6 === 0 ? 'overloaded_error: upstream 529' : null,
        createdAt: iso(i / 3),
      })),
      page: 1,
      limit,
      total: 15,
      range: { from: day(0), to: day(29) },
      summary: bucket({
        calls: 8421,
        failures: 96,
        costMicroUsd: 41200000,
        inputTokens: 9120000,
        outputTokens: 2210000,
        unpricedCalls: 140,
        cacheReadTokens: 3300000,
        cacheWriteTokens: 410000,
        avgLatencyMs: 1180,
        maxLatencyMs: 9400,
      }),
      byProvider: [
        bucket({ provider: 'anthropic', calls: 6100, failures: 40, costMicroUsd: 33000000, inputTokens: 7000000, outputTokens: 1700000 }),
        bucket({ provider: 'gemini', calls: 1700, failures: 31, costMicroUsd: 6100000, inputTokens: 1600000, outputTokens: 380000 }),
        bucket({ provider: 'groq', calls: 621, failures: 25, costMicroUsd: 2100000, inputTokens: 520000, outputTokens: 130000 }),
      ],
      byFeature: [
        bucket({ feature: 'evaluate', calls: 4900, failures: 44, costMicroUsd: 21000000 }),
        bucket({ feature: 'meeting_turn', calls: 2600, failures: 36, costMicroUsd: 14000000 }),
        bucket({ feature: 'interview_eval', calls: 700, failures: 12, costMicroUsd: 4200000 }),
        bucket({ feature: 'cv_summary', calls: 221, failures: 4, costMicroUsd: 2000000 }),
      ],
      daily: Array.from({ length: 30 }, (_, i) => ({
        day: day(i),
        calls: 200 + Math.round(90 * Math.sin(i / 4)) + i * 3,
        failures: i % 7,
        costMicroUsd: 900000 + i * 22000,
        inputTokens: 260000 + i * 4000,
        outputTokens: 62000 + i * 900,
      })),
    };
  }

  if (pathname.endsWith('/admin/reports'))
    return {
      reports: Array.from({ length: 10 }, (_, i) => ({
        id: `rep_${i}`,
        answerId: `ans_${i}`,
        reporterId: USERS[i % USERS.length].id,
        reason: 'التقييم غير منطقي — الإجابة كانت صحيحة تمامًا لكن الدرجة جاءت منخفضة جدًا.',
        resolved: i % 3 === 0,
        createdAt: iso(i),
        answer: {
          id: `ans_${i}`,
          userAnswer:
            'في مشروع سابق اختلفت مع زميلي حول اختيار قاعدة البيانات، فرتّبنا اجتماعًا قصيرًا وقارنّا الخيارين بمعايير واضحة ثم اتفقنا على الأنسب.',
          aiScore: i % 4 === 0 ? null : 40 + i * 4,
          answeredAt: iso(i),
          sessionId: `ses_${i}`,
          sessionKind: i % 2 ? 'meeting' : 'practice',
          question: {
            id: i % 2 ? null : String(1000 + i),
            text: 'احكِ لي عن موقف واجهت فيه خلافًا مع زميل في العمل؟',
            source: i % 2 ? 'meeting' : 'catalogue',
          },
        },
        reporter: { id: USERS[i % USERS.length].id, email: USERS[i % USERS.length].email, name: USERS[i % USERS.length].name },
      })),
      page: 1,
      limit,
      total: 10,
      openCount: 7,
    };

  if (pathname.endsWith('/admin/settings'))
    return {
      settings: {
        free_daily_question_limit: '5',
        subscription_monthly_price_egp: '199',
        subscription_yearly_price_egp: '1799',
        push_welcome_ar: 'أهلًا بك في ثقتي! ابدأ أول مقابلة تدريبية الآن.',
        push_welcome_en: 'Welcome to Thiqty! Start your first mock interview.',
      },
      updatedAt: {
        free_daily_question_limit: iso(3),
        subscription_monthly_price_egp: iso(12),
        subscription_yearly_price_egp: null,
        push_welcome_ar: iso(1),
        push_welcome_en: null,
      },
      wired: ['free_daily_question_limit', 'subscription_monthly_price_egp'],
    };

  if (pathname.endsWith('/admin/integrations')) {
    const cred = (key, o = {}) => ({
      key,
      group: key.startsWith('EASYKASH') ? 'payments' : 'ai',
      type: 'text',
      secret: false,
      options: null,
      testable: false,
      isSet: true,
      source: 'db',
      last4: null,
      value: 'value',
      updatedAt: iso(5),
      updatedBy: ADMIN.id,
      updatedByName: ADMIN.name,
      updatedByEmail: ADMIN.email,
      ...o,
    });
    return {
      cryptoAvailable: true,
      credentials: [
        cred('EASYKASH_API_KEY', { secret: true, type: 'secret', testable: true, last4: 'a91f', value: null }),
        cred('EASYKASH_WEBHOOK_SECRET', { secret: true, type: 'secret', isSet: false, source: 'unset', last4: null, value: null, updatedAt: null, updatedByName: null }),
        cred('EASYKASH_ENABLED', { type: 'boolean', value: 'true' }),
        cred('EASYKASH_BASE_URL', { type: 'url', value: 'https://back.easykash.net', testable: true }),
        cred('EASYKASH_PAY_PATH', { type: 'path', value: '/api/directpayv1/pay' }),
        cred('EASYKASH_PAYMENT_OPTIONS', { type: 'csv', value: 'card,wallet,fawry' }),
        cred('EASYKASH_SIGNATURE_HEADER', { value: 'x-easykash-signature', source: 'env' }),
        cred('EASYKASH_SIGNATURE_ALGO', { type: 'select', options: ['sha256', 'sha512'], value: 'sha256' }),
        cred('EASYKASH_SIGNATURE_FIELDS', { type: 'csv', value: 'amount,currency,reference' }),
        cred('ANTHROPIC_API_KEY', { secret: true, type: 'secret', testable: true, last4: '7Kd2', value: null }),
        cred('GEMINI_API_KEY', { secret: true, type: 'secret', testable: true, source: 'env', last4: 'q0Zz', value: null }),
        cred('GROQ_API_KEY', { secret: true, type: 'secret', testable: true, isSet: false, source: 'error', last4: null, value: null }),
        cred('AI_ENABLED', { type: 'boolean', value: 'true' }),
        cred('AI_PROVIDER', { type: 'select', options: ['anthropic', 'gemini', 'groq'], value: 'anthropic' }),
        cred('CLAUDE_MODEL', { value: 'claude-sonnet-4-6' }),
        cred('AI_MODEL', { value: 'claude-sonnet-4-6' }),
      ],
    };
  }

  if (pathname.endsWith('/admin/audit'))
    return {
      logs: Array.from({ length: 12 }, (_, i) => ({
        id: `aud_${i}`,
        adminId: ADMIN.id,
        action: ['users.update', 'questions.create', 'settings.update', 'admins.delete', 'reports.resolve', 'payments.refund'][i % 6],
        entityType: ['user', 'question', 'setting', 'admin', 'report', 'payment'][i % 6],
        entityId: `ent_${i}`,
        metadata: JSON.stringify({ isDisabled: true, reason: 'abuse' }),
        ip: '156.203.44.10',
        createdAt: iso(i / 2),
        admin: i === 3 ? null : { id: ADMIN.id, name: ADMIN.name, email: ADMIN.email, role: 'super_admin' },
      })),
      page: 1,
      limit,
      total: 12,
      facets: {
        actions: ['users.update', 'questions.create', 'settings.update', 'admins.delete'],
        entityTypes: ['user', 'question', 'setting', 'admin'],
        admins: [{ id: ADMIN.id, name: ADMIN.name, email: ADMIN.email }],
      },
    };

  if (pathname.endsWith('/admin/admins'))
    return {
      admins: [
        { id: 'adm_1', email: 'super@thiqty.app', name: 'خالد أحمد', role: 'super_admin', isActive: true, lastLoginAt: iso(0), createdAt: iso(200) },
        { id: 'adm_2', email: 'mod@thiqty.app', name: 'منى صلاح', role: 'moderator', isActive: true, lastLoginAt: iso(4), createdAt: iso(120) },
        { id: 'adm_3', email: 'editor@thiqty.app', name: 'طارق فؤاد', role: 'content_editor', isActive: false, lastLoginAt: null, createdAt: iso(60) },
      ],
      total: 3,
    };

  return null;
}

/* -------------------------------- routes ---------------------------------- */

const ROUTES = [
  { name: '01-login', path: '/login', auth: false },
  { name: '02-dashboard', path: '/' },
  { name: '03-analytics', path: '/analytics' },
  { name: '04-users', path: '/users' },
  { name: '05-user-detail', path: '/users/usr_0001' },
  { name: '06-questions', path: '/questions' },
  { name: '07-categories', path: '/categories' },
  { name: '08-subscriptions', path: '/subscriptions' },
  { name: '09-payments', path: '/payments' },
  { name: '10-ai-usage', path: '/ai-usage' },
  { name: '11-reports', path: '/reports' },
  { name: '12-settings', path: '/settings' },
  { name: '13-integrations-payments', path: '/integrations/payments' },
  { name: '14-integrations-ai', path: '/integrations/ai' },
  { name: '15-admins', path: '/admins' },
  { name: '16-audit', path: '/audit' },
  { name: '17-forbidden', path: '/403' },
  { name: '18-notfound', path: '/does-not-exist' },
  { name: '19-dashboard-dark', path: '/', mode: 'dark' },
  { name: '20-dashboard-mobile', path: '/', viewport: { width: 390, height: 844 } },
  { name: '21-users-mobile', path: '/users', viewport: { width: 390, height: 844 } },
  { name: '22-login-mobile', path: '/login', auth: false, viewport: { width: 390, height: 844 } },
  { name: '23-dashboard-moderator', path: '/', role: 'moderator' },
  { name: '24-questions-moderator', path: '/questions', role: 'moderator' },
];

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars=false', '--font-render-hinting=none', '--lang=ar-EG'],
  defaultViewport: { width: VW, height: VH, deviceScaleFactor: 1 },
});

const report = [];

for (const route of ROUTES) {
  const page = await browser.newPage();
  await page.setViewport({ ...(route.viewport || { width: VW, height: VH }), deviceScaleFactor: 1 });

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const unmocked = [];

  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      consoleErrors.push(`[${m.type()}] ${m.text()}`.slice(0, 400));
    }
  });
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 400)));
  page.on('requestfailed', (r) => failedRequests.push(`${r.url()} :: ${r.failure()?.errorText}`));
  page.on('response', (r) => {
    if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
  });

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname.includes('/admin/') && url.pathname.includes('/api/')) {
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'access-control-max-age': '600',
      };
      if (req.method() === 'OPTIONS') {
        return req.respond({ status: 204, headers: cors, body: '' });
      }
      const body = mockFor(url.pathname, url.search);
      if (body === null) {
        unmocked.push(`${req.method()} ${url.pathname}`);
        return req.respond({ status: 404, headers: cors, contentType: 'application/json', body: '{"error":"unmocked"}' });
      }
      return req.respond({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        headers: cors,
        body: JSON.stringify(body),
      });
    }
    if (url.hostname !== 'localhost') {
      unmocked.push(`EXTERNAL ${req.url()}`);
      return req.abort();
    }
    req.continue();
  });

  const auth = route.auth !== false;
  const role = route.role || 'super_admin';
  const mode = route.mode || 'light';
  await page.evaluateOnNewDocument(
    (auth, role, mode) => {
      localStorage.setItem('mui-mode', mode);
      if (auth) {
        localStorage.setItem('admin_token', 'mock.jwt.token');
        localStorage.setItem(
          'admin_auth',
          JSON.stringify({
            state: {
              token: 'mock.jwt.token',
              admin: { id: 'adm_1', email: 'super@thiqty.app', name: 'خالد أحمد', role },
            },
            version: 0,
          }),
        );
      } else {
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_auth');
      }
    },
    auth,
    role,
    mode,
  );

  // A moderator/content_editor session must see the role the mock /auth/me
  // returns, so keep them consistent.
  ADMIN.role = role;

  const url = `http://localhost:${PORT}/admin${route.path}`;
  let navError = null;
  try {
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  } catch (e) {
    navError = String(e).slice(0, 200);
  }
  await new Promise((r) => setTimeout(r, 1200));

  const metrics = await page.evaluate(() => {
    const de = document.documentElement;
    const body = document.body;
    const wide = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > window.innerWidth + 2 || r.left < -2)) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' && r.width <= 2) continue;
        wide.push(
          `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ').slice(0, 3).join('.')} left=${Math.round(r.left)} right=${Math.round(r.right)}`,
        );
      }
    }
    const rootText = (body.innerText || '').trim();
    return {
      dir: de.getAttribute('dir'),
      lang: de.getAttribute('lang'),
      colorScheme: de.getAttribute('data-mui-color-scheme'),
      bodyDir: getComputedStyle(body).direction,
      scrollWidth: body.scrollWidth,
      docScrollWidth: de.scrollWidth,
      innerWidth: window.innerWidth,
      fontFamily: getComputedStyle(body).fontFamily,
      cairoLoaded: Array.from(document.fonts).some((f) => f.family.includes('Cairo') && f.status === 'loaded'),
      bodyBg: getComputedStyle(body).backgroundColor,
      textLen: rootText.length,
      title: document.title,
      urlPath: location.pathname,
      h1: Array.from(document.querySelectorAll('h1,h2,h3,h4')).slice(0, 4).map((e) => e.textContent?.trim().slice(0, 60)),
      overflowing: wide.slice(0, 8),
      // MUI drawer/appbar side, to prove the shell is mirrored
      drawerLeft: (() => {
        const d = document.querySelector('.MuiDrawer-paper, aside, nav');
        if (!d) return null;
        const r = d.getBoundingClientRect();
        return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
      })(),
    };
  });

  const shot = path.join(OUT, `${route.name}.png`);
  await page.screenshot({ path: shot, fullPage: true });

  report.push({
    route: route.path,
    name: route.name,
    role,
    mode,
    viewport: route.viewport || { width: VW, height: VH },
    navError,
    metrics,
    consoleErrors,
    pageErrors,
    failedRequests: [...new Set(failedRequests)],
    unmocked: [...new Set(unmocked)],
    screenshot: shot,
  });

  console.log(
    `${route.name.padEnd(28)} dir=${metrics.dir} sw=${metrics.scrollWidth}/${metrics.innerWidth} text=${metrics.textLen} err=${pageErrors.length} cons=${consoleErrors.length} over=${metrics.overflowing.length}`,
  );
  await page.close();
}

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();
server.close();
console.log('\nWrote', path.join(OUT, 'report.json'));
