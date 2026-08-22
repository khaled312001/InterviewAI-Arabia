/** Zoom probe: clipped cells, date-input placeholders, LTR strings in RTL. */
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(ROOT, 'admin', 'dist');
const OUT = path.join(HERE, '.out', 'admin-audit');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 5205;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = p.startsWith('/admin/') ? p.slice(7) : '';
  const f = path.join(DIST, rel);
  if (rel && fs.existsSync(f) && fs.statSync(f).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    return res.end(fs.readFileSync(f));
  }
  res.writeHead(200, { 'Content-Type': MIME['.html'] }).end(fs.readFileSync(path.join(DIST, 'index.html')));
});
await new Promise((r) => server.listen(PORT, r));

const ADMIN = { id: 'adm_1', email: 'super@interprova.app', name: 'خالد أحمد', role: 'super_admin' };
const CATS = [{ id: 1, nameAr: 'الهندسة البرمجية', nameEn: 'Software Engineering', icon: '💻', isPremium: false }];
const QUESTIONS = Array.from({ length: 3 }, (_, i) => ({
  id: String(1000 + i), categoryId: 1,
  questionAr: 'احكِ لي عن موقف واجهت فيه خلافًا مع زميل في العمل وكيف تعاملت معه بشكل احترافي؟',
  questionEn: 'Tell me about a time you disagreed with a colleague and how you handled it.',
  difficulty: 'medium', usageCount: 40, isActive: true, createdAt: new Date(Date.now() - 4 * 86400000).toISOString(),
  category: CATS[0],
}));

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--lang=ar-EG'],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 3 },
});

async function open(route) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.pathname.includes('/api/')) {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors, body: '' });
      let body = {};
      if (u.pathname.endsWith('/auth/me')) body = { admin: ADMIN };
      else if (u.pathname.endsWith('/admin/categories')) body = { categories: CATS.map((c) => ({ ...c, descriptionAr: null, descriptionEn: null, isActive: true, sortOrder: 1, createdAt: new Date().toISOString(), questionCount: 3, sessionCount: 3 })) };
      else if (u.pathname.endsWith('/admin/questions')) body = { questions: QUESTIONS, total: 3 };
      else if (u.pathname.endsWith('/admin/payments')) body = { payments: [], page: 1, limit: 25, total: 0, summary: { byStatus: {}, paidMinor: 0, paidCount: 0, refundedMinor: 0, refundedCount: 0, netMinor: 0, currencies: ['EGP'] } };
      else if (u.pathname.endsWith('/admin/reports')) body = { reports: [], page: 1, limit: 1, total: 0, openCount: 0 };
      return req.respond({ status: 200, headers: cors, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
    }
    if (u.hostname !== 'localhost') return req.abort();
    req.continue();
  });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('mui-mode', 'light');
    localStorage.setItem('admin_token', 't');
    localStorage.setItem('admin_auth', JSON.stringify({ state: { token: 't', admin: { id: 'adm_1', email: 'x@y.z', name: 'خالد', role: 'super_admin' } }, version: 0 }));
  });
  await page.goto(`http://localhost:${PORT}/admin${route}`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1200));
  return page;
}

/* payments date inputs */
{
  const page = await open('/payments');
  const info = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input')).map((i) => {
      const r = i.getBoundingClientRect();
      const cs = getComputedStyle(i);
      return { type: i.type, ph: i.placeholder, val: i.value, dir: cs.direction, textAlign: cs.textAlign, box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
    }),
  );
  console.log('\n== /payments inputs:', JSON.stringify(info, null, 1));
  const box = info.find((i) => i.type === 'date')?.box;
  if (box) await page.screenshot({ path: path.join(OUT, 'zoom-payments-dates.png'), clip: { x: box.x - 240, y: box.y - 24, width: 620, height: box.h + 48 } });
  await page.close();
}

/* questions grid cells */
{
  const page = await open('/questions');
  const cells = await page.evaluate(() => {
    const out = [];
    for (const c of document.querySelectorAll('.MuiDataGrid-cell')) {
      const inner = c.firstElementChild || c;
      const r = c.getBoundingClientRect();
      out.push({
        field: c.getAttribute('data-field'),
        text: (c.textContent || '').trim().slice(0, 90),
        cellW: Math.round(r.width),
        innerScrollW: inner.scrollWidth, innerClientW: inner.clientWidth,
        overflowX: getComputedStyle(inner).overflowX, textOverflow: getComputedStyle(inner).textOverflow,
        dir: getComputedStyle(inner).direction,
      });
    }
    return out.slice(0, 9);
  });
  console.log('\n== /questions first-row cells:', JSON.stringify(cells, null, 1));
  const grid = await page.$('.MuiDataGrid-root');
  const gb = await grid.boundingBox();
  await page.screenshot({ path: path.join(OUT, 'zoom-questions-row.png'), clip: { x: gb.x, y: gb.y, width: gb.width, height: 130 } });
  await page.close();
}

await browser.close();
server.close();
