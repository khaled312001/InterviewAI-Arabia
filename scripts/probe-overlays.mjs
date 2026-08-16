/** Interaction probe: form drawer, command palette, confirm dialog, rail mode. */
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
const PORT = 5207;
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

const ADMIN = { id: 'adm_1', email: 'super@thiqty.app', name: 'خالد أحمد', role: 'super_admin' };
const CAT = { id: 1, nameAr: 'الهندسة البرمجية', nameEn: 'Software Engineering', icon: '💻', isPremium: false };
const USERS = [{ id: 'usr_0001', email: 'candidate1@example.com', name: 'أحمد محمد', phone: null, language: 'ar', plan: 'free', dailyQuestionsUsed: 1, lastResetDate: null, premiumUntil: null, isDisabled: false, emailVerifiedAt: null, lastLoginAt: new Date().toISOString(), createdAt: new Date().toISOString() }];

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--lang=ar-EG'],
  defaultViewport: { width: 1440, height: 900 },
});

async function open(route) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 300)); });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.pathname.includes('/api/')) {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors, body: '' });
      let body = {};
      if (u.pathname.endsWith('/auth/me')) body = { admin: ADMIN };
      else if (u.pathname.endsWith('/admin/categories')) body = { categories: [{ ...CAT, descriptionAr: null, descriptionEn: null, isActive: true, sortOrder: 1, createdAt: new Date().toISOString(), questionCount: 3, sessionCount: 3 }] };
      else if (u.pathname.endsWith('/admin/questions')) body = { questions: [], total: 0 };
      else if (u.pathname.endsWith('/admin/users')) body = { users: USERS, page: 1, limit: 25, total: 1 };
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
  await new Promise((r) => setTimeout(r, 900));
  return { page, errs };
}

const overflow = (page) => page.evaluate(() => ({ sw: document.body.scrollWidth, iw: window.innerWidth }));

/* form drawer */
{
  const { page, errs } = await open('/questions');
  const btns = await page.$$eval('button', (b) => b.map((x) => x.textContent.trim()));
  const idx = btns.findIndex((t) => t.includes('سؤال جديد'));
  if (idx >= 0) {
    const all = await page.$$('button');
    await all[idx].click();
    await new Promise((r) => setTimeout(r, 900));
    const box = await page.evaluate(() => {
      const p = document.querySelector('.MuiDrawer-paper');
      const r = p?.getBoundingClientRect();
      return r && { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
    });
    console.log('form drawer box:', JSON.stringify(box), 'overflow:', JSON.stringify(await overflow(page)), 'errors:', errs.length);
    await page.screenshot({ path: path.join(OUT, 'ovl-question-drawer.png') });
  } else console.log('no "سؤال جديد" button found:', JSON.stringify(btns));
  await page.close();
}

/* command palette */
{
  const { page, errs } = await open('/users');
  await page.keyboard.down('Control'); await page.keyboard.press('KeyK'); await page.keyboard.up('Control');
  await new Promise((r) => setTimeout(r, 800));
  const dlg = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"], .MuiDialog-paper');
    const r = d?.getBoundingClientRect();
    return r && { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), text: d.textContent.trim().slice(0, 120) };
  });
  console.log('command palette:', JSON.stringify(dlg), 'errors:', errs.length);
  await page.screenshot({ path: path.join(OUT, 'ovl-command-palette.png') });
  await page.close();
}

/* rail toggle */
{
  const { page } = await open('/users');
  const clicked = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.getAttribute('aria-label') || '').includes('تصغير القائمة'));
    if (!b) return false; b.click(); return true;
  });
  await new Promise((r) => setTimeout(r, 900));
  const aside = await page.evaluate(() => {
    const a = document.querySelector('aside').getBoundingClientRect();
    return { left: Math.round(a.left), right: Math.round(a.right), width: Math.round(a.width) };
  });
  console.log('rail clicked:', clicked, 'aside:', JSON.stringify(aside), 'overflow:', JSON.stringify(await overflow(page)));
  await page.screenshot({ path: path.join(OUT, 'ovl-rail.png') });
  await page.close();
}

await browser.close();
server.close();
