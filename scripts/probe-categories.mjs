/** Re-check the /categories shell anomaly seen in the audit screenshot. */
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
const PORT = 5203;
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

const CATS = Array.from({ length: 5 }, (_, i) => ({
  id: i + 1, nameAr: ['الهندسة البرمجية', 'التسويق الرقمي', 'الموارد البشرية', 'المبيعات', 'المحاسبة والمالية'][i],
  nameEn: ['Software Engineering', 'Digital Marketing', 'Human Resources', 'Sales', 'Accounting & Finance'][i],
  descriptionAr: 'وصف', descriptionEn: 'desc', icon: '💻', isPremium: i % 2 === 1, isActive: i !== 3,
  sortOrder: i + 1, createdAt: new Date().toISOString(), questionCount: 40 - i * 6, sessionCount: 300 - i * 40,
}));

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--no-sandbox', '--lang=ar-EG'], defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
await page.setRequestInterception(true);
page.on('request', (req) => {
  const u = new URL(req.url());
  if (u.pathname.includes('/api/')) {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors, body: '' });
    let body = {};
    if (u.pathname.endsWith('/auth/me')) body = { admin: { id: 'adm_1', email: 'super@interprova.app', name: 'خالد أحمد', role: 'super_admin' } };
    else if (u.pathname.endsWith('/admin/categories')) body = { categories: CATS };
    else if (u.pathname.endsWith('/admin/reports')) body = { reports: [], page: 1, limit: 1, total: 0, openCount: 7 };
    return req.respond({ status: 200, headers: cors, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
  }
  if (u.hostname !== 'localhost') return req.abort();
  req.continue();
});
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('admin_token', 't');
  localStorage.setItem('admin_auth', JSON.stringify({ state: { token: 't', admin: { id: 'adm_1', email: 'x@y.z', name: 'خالد', role: 'super_admin' } }, version: 0 }));
});
await page.goto(`http://localhost:${PORT}/admin/categories`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1500));

const m = await page.evaluate(() => {
  const aside = document.querySelector('aside');
  const r = aside?.getBoundingClientRect();
  const shell = document.querySelector('aside')?.parentElement;
  const sr = shell?.getBoundingClientRect();
  const cs = shell ? getComputedStyle(shell) : null;
  return {
    aside: r && { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) },
    shell: sr && { left: Math.round(sr.left), right: Math.round(sr.right), width: Math.round(sr.width) },
    display: cs?.display, gridTemplateColumns: cs?.gridTemplateColumns, direction: cs?.direction,
    bodyScrollW: document.body.scrollWidth, innerW: window.innerWidth,
    scrollX: window.scrollX,
  };
});
console.log(JSON.stringify(m, null, 2));
await page.screenshot({ path: path.join(OUT, 'probe-categories-viewport.png') });
await page.screenshot({ path: path.join(OUT, 'probe-categories-full.png'), fullPage: true });
await browser.close();
server.close();
