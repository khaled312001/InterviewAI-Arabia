/** Follow-up probe: sidebar scrollability, DataGrid horizontal scroll, bidi. */
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
const PORT = 5201;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = p.startsWith('/admin/') ? p.slice(7) : '';
  const file = path.join(DIST, rel);
  if (rel && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    return res.end(fs.readFileSync(file));
  }
  res.writeHead(200, { 'Content-Type': MIME['.html'] }).end(fs.readFileSync(path.join(DIST, 'index.html')));
});
await new Promise((r) => server.listen(PORT, r));

const { default: mod } = await import('node:module');
// reuse the mock table from the audit script by re-importing its logic is
// overkill; the probe only needs the shell + one grid, so a tiny mock suffices.
const mocks = JSON.parse(fs.readFileSync(path.join(OUT, 'report.json'), 'utf8')) && null;

const ADMIN = { id: 'adm_1', email: 'super@thiqty.app', name: 'خالد أحمد', role: 'super_admin' };
const USERS = Array.from({ length: 20 }, (_, i) => ({
  id: `usr_${String(i + 1).padStart(4, '0')}`, email: `candidate${i + 1}@example.com`, name: 'أحمد محمد',
  phone: null, language: 'ar', plan: i % 3 ? 'free' : 'premium', dailyQuestionsUsed: i % 6,
  lastResetDate: null, premiumUntil: i % 3 ? null : new Date(Date.now() + 6e8).toISOString(),
  isDisabled: false, emailVerifiedAt: null, lastLoginAt: new Date().toISOString(), createdAt: new Date().toISOString(),
}));

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--no-sandbox', '--lang=ar-EG'],
  defaultViewport: { width: 1440, height: 900 },
});

async function open(route, height = 900) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.pathname.includes('/api/') && u.pathname.includes('/admin/')) {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors, body: '' });
      let body = {};
      if (u.pathname.endsWith('/auth/me')) body = { admin: ADMIN };
      else if (u.pathname.endsWith('/admin/users')) body = { users: USERS, page: 1, limit: 25, total: 20 };
      else if (u.pathname.endsWith('/admin/reports')) body = { reports: [], page: 1, limit: 1, total: 0, openCount: 7 };
      return req.respond({ status: 200, headers: cors, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
    }
    if (u.hostname !== 'localhost') return req.abort();
    req.continue();
  });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('admin_token', 't');
    localStorage.setItem('admin_auth', JSON.stringify({ state: { token: 't', admin: { id: 'adm_1', email: 'super@thiqty.app', name: 'خالد أحمد', role: 'super_admin' } }, version: 0 }));
  });
  await page.goto(`http://localhost:${PORT}/admin${route}`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 900));
  return page;
}

/* ---- 1. sidebar scrollability at several viewport heights ---- */
for (const h of [1080, 900, 800, 720]) {
  const page = await open('/users', h);
  const info = await page.evaluate(() => {
    const drawer = document.querySelector('aside');
    if (!drawer) return { error: 'no drawer' };
    const items = Array.from(drawer.querySelectorAll('a')).map((a) => {
      const r = a.getBoundingClientRect();
      return { t: a.textContent.trim().slice(0, 30), top: Math.round(r.top), bottom: Math.round(r.bottom), visible: r.bottom <= window.innerHeight && r.top >= 0 };
    });
    // find the scrollable ancestor of the nav list
    let scrollers = [];
    for (const el of drawer.querySelectorAll('*')) {
      if (el.scrollHeight > el.clientHeight + 2) {
        const cs = getComputedStyle(el);
        scrollers.push({ cls: String(el.className).slice(0, 60), overflowY: cs.overflowY, scrollH: el.scrollHeight, clientH: el.clientHeight });
      }
    }
    return { drawerH: Math.round(drawer.getBoundingClientRect().height), winH: window.innerHeight, items, scrollers };
  });
  console.log(`\n=== viewport height ${h}`);
  console.log('drawer', info.drawerH, 'win', info.winH);
  console.log('hidden items:', info.items.filter((i) => !i.visible).map((i) => `${i.t}@${i.top}-${i.bottom}`).join(' | ') || 'none');
  console.log('scrollable containers inside drawer:', JSON.stringify(info.scrollers));
  if (h === 900) await page.screenshot({ path: path.join(OUT, 'probe-sidebar-900.png'), clip: { x: 1176, y: 0, width: 264, height: 900 } });
  await page.close();
}

/* ---- 2. DataGrid horizontal scroll on /users ---- */
{
  const page = await open('/users');
  const grid = await page.evaluate(() => {
    const scroller = document.querySelector('.MuiDataGrid-virtualScroller');
    const root = document.querySelector('.MuiDataGrid-root');
    const heads = Array.from(document.querySelectorAll('.MuiDataGrid-columnHeaderTitle')).map((e) => e.textContent.trim());
    const headEls = Array.from(document.querySelectorAll('.MuiDataGrid-columnHeader')).map((e) => {
      const r = e.getBoundingClientRect();
      return { t: e.textContent.trim().slice(0, 20), left: Math.round(r.left), right: Math.round(r.right) };
    });
    return {
      rootW: root && Math.round(root.getBoundingClientRect().width),
      scrollW: scroller?.scrollWidth, clientW: scroller?.clientWidth, scrollLeft: scroller?.scrollLeft,
      overflowX: scroller && getComputedStyle(scroller).overflowX,
      heads, headEls,
    };
  });
  console.log('\n=== /users DataGrid', JSON.stringify(grid, null, 1));
  await page.close();
}

/* ---- 3. bidi rendering of LTR strings in RTL context ---- */
{
  const page = await open('/users');
  const bidi = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.children.length) continue;
      const t = (el.textContent || '').trim();
      if (!t) continue;
      // a leading neutral char before latin content is the reordering hazard
      if (/^[/.,:#(+-]/.test(t) && /[A-Za-z]/.test(t)) {
        const cs = getComputedStyle(el);
        out.push({ t: t.slice(0, 50), dir: cs.direction, unicodeBidi: cs.unicodeBidi, tag: el.tagName });
      }
    }
    return out;
  });
  console.log('\n=== bidi hazards on /users:', JSON.stringify(bidi));
  await page.close();
}

await browser.close();
server.close();
