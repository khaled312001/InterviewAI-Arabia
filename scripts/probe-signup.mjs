/**
 * Prove — against production — that creating an account works end to end, and
 * measure WHERE the time goes when it feels stuck.
 *
 * "The sign-up page hangs" has more than one possible home: the request, the
 * post-success navigation, the first screens of the signed-in app, or the
 * form itself. Reading code cannot tell them apart. This drives the deployed
 * bundle and timestamps each hop, so a stall points at exactly one of them.
 *
 * It creates ONE real account with a throwaway address and deletes it through
 * the same DELETE /user/me the app's own "delete account" uses, so production
 * is left as it was found. Pass KEEP=1 to leave it.
 *
 *   node scripts/probe-signup.mjs
 */

import puppeteer from 'puppeteer-core';

const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.env.APP_URL || 'https://interprova.com';
const STAMP = Date.now().toString(36);
const EMAIL = `probe.signup.${STAMP}@interprova.com`;
const PASS = `Probe#${STAMP}x9`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`.padStart(6);
const ok = (c, m) => console.log(`  ${at()} ${c ? '✅' : '❌'} ${m}`);
const note = (m) => console.log(`  ${at()}    ${m}`);

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--lang=ar-EG', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 420, height: 900, deviceScaleFactor: 1 });

const errors = [];
const api = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/api/')) api.push({ at: at(), status: r.status(), path: u.replace(BASE, '').split('?')[0] });
});

/** Visible text, whitespace collapsed. */
const bodyText = () => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));

/** Clicks the smallest visible element whose text matches — the leaf, not its row. */
async function clickText(re) {
  const box = await page.evaluate((src) => {
    const rx = new RegExp(src);
    const hits = [...document.querySelectorAll('div,span,a,button')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && rx.test((el.innerText || '').trim());
    });
    hits.sort((a, b) => (a.innerText.length - b.innerText.length));
    const el = hits[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, re.source);
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  return true;
}

async function googleButtonVisible() {
  return page.evaluate(() => [...document.querySelectorAll('[role="button"],div')].some((el) => {
    const r = el.getBoundingClientRect();
    return r.height > 20 && /بجوجل|with Google/i.test(el.getAttribute('aria-label') || '');
  }));
}

console.log(`\n▸ 1. load the app  (${EMAIL})`);
await page.goto(`${BASE}/app/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="onboarding"],[data-testid="login"]', { timeout: 60000 });
ok(true, 'first screen rendered');

console.log('\n▸ 2. reach sign-up');
for (let i = 0; i < 6; i += 1) {
  if (await page.$('[data-testid="login-email"]')) break;
  const cta = await page.$('[data-testid="onboarding-cta"]');
  if (!cta) break;
  await cta.click().catch(() => {});
  await sleep(900);
}
await page.waitForSelector('[data-testid="login-email"]', { timeout: 20000 });
ok(await googleButtonVisible(), 'login: Google button present on arrival');
const went = await clickText(/^(إنشاء حساب|أنشئ حساب|سجّل الآن|Create account|Sign up)/);
note(went ? 'tapped the sign-up link' : 'sign-up link not found by text');
await page.waitForSelector('[data-testid="signup-name"]', { timeout: 15000 });
ok(true, 'sign-up form rendered');
let gAt = null;
for (let i = 0; i < 20 && !gAt; i += 1) { if (await googleButtonVisible()) gAt = at(); else await sleep(250); }
ok(Boolean(gAt), gAt ? `sign-up: Google button visible by ${gAt.trim()}` : 'sign-up: Google button NEVER appeared (5s)');

console.log('\n▸ 3. typing latency (the form itself)');
const typeStart = Date.now();
await page.type('[data-testid="signup-name"] input, input[data-testid="signup-name"]', 'Probe Signup', { delay: 0 }).catch(async () => {
  await page.click('[data-testid="signup-name"]'); await page.keyboard.type('Probe Signup');
});
await page.type('[data-testid="signup-email"]', EMAIL, { delay: 0 });
await page.type('[data-testid="signup-password"]', PASS, { delay: 0 });
ok(Date.now() - typeStart < 6000, `typed three fields in ${Date.now() - typeStart}ms`);

console.log('\n▸ 4. submit');
const submitAt = Date.now();
await page.click('[data-testid="signup-submit"]');
let landed = null;
for (let i = 0; i < 60; i += 1) {
  await sleep(500);
  const txt = await bodyText();
  if (/مستخدم بالفعل|already|تعذّر|خطأ|محاولات/i.test(txt) && !(await page.$('[data-testid="signup-name"]')) === false) {
    const banner = txt.match(/(البريد[^.]{0,60}|تعذّر[^.]{0,60}|محاولات[^.]{0,60})/);
    if (banner) { note(`banner: ${banner[0]}`); break; }
  }
  if (!(await page.$('[data-testid="signup-name"]'))) { landed = Date.now() - submitAt; break; }
}
ok(landed !== null, landed !== null ? `left the sign-up screen after ${landed}ms` : 'STILL on sign-up after 30s');
await sleep(4000);
const after = await bodyText();
note(`now showing: ${after.slice(0, 140)}`);

console.log('\n▸ 5. api calls');
for (const c of api) console.log(`  ${c.at}   ${c.status}  ${c.path}`);

console.log('\n▸ 6. clean up');
if (process.env.KEEP) {
  note('KEEP set — account left in place');
} else {
  const token = await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (/access_token/.test(k)) return localStorage.getItem(k);
    return null;
  });
  let tok = token;
  if (!tok) {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASS }),
    });
    tok = r.ok ? (await r.json()).token : null;
  }
  if (tok) {
    const r = await fetch(`${BASE}/api/user/me`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ password: PASS }),
    });
    ok(r.ok, `probe account deleted (${r.status})`);
  } else {
    ok(false, 'could not sign the probe account in to delete it — delete it from /admin');
  }
}

if (errors.length) {
  console.log('\n▸ runtime errors');
  for (const e of [...new Set(errors)].slice(0, 12)) console.log('   ⚠', e);
}
await page.screenshot({ path: process.env.SHOT || 'probe-signup.png' });
await browser.close();
console.log('');
