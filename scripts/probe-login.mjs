/**
 * Prove — against production, not a dev server — that sign-in works.
 *
 * Every previous "the Google button doesn't show" report was diagnosed by
 * reading code, which is how a fix ships that changes nothing the user sees.
 * This drives the real deployed bundle in a real browser and reports what is
 * actually on the screen at each step.
 *
 * It cannot complete a Google sign-in (that needs a human and a real Google
 * account), so it verifies everything up to the moment Google takes over:
 * the config endpoint, the button's presence, the popup's target URL, and the
 * client id / redirect_uri actually being sent. Those are where all four of the
 * reported failures lived.
 *
 *   node scripts/probe-login.mjs
 */

import puppeteer from 'puppeteer-core';

const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.env.APP_URL || 'https://interprova.com';
const EMAIL = process.env.PROBE_EMAIL || 'reviewer@interprova.app';
const PASS = process.env.PROBE_PASS || 'InterprovaReview#2026';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => console.log(`  ${c ? '✅' : '❌'} ${m}`);

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--lang=ar-EG', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 480, height: 900, deviceScaleFactor: 2 });

const failures = [];
page.on('pageerror', (e) => failures.push(String(e).slice(0, 160)));
page.on('requestfailed', (r) => {
  const u = r.url();
  if (u.startsWith(BASE)) failures.push(`request failed ${r.failure()?.errorText} ${u.slice(0, 100)}`);
});

console.log('\n▸ 1. config endpoint');
const cfg = await (await fetch(`${BASE}/api/auth/google/config`)).json();
ok(cfg.enabled === true, `enabled = ${cfg.enabled}`);
ok(Boolean(cfg.webClientId), `webClientId  ${String(cfg.webClientId).slice(0, 24)}…`);
ok(Boolean(cfg.androidClientId), `androidClientId ${String(cfg.androidClientId).slice(0, 24)}…`);

console.log('\n▸ 2. the app loads');
await page.goto(`${BASE}/app/`, { waitUntil: 'networkidle2', timeout: 90000 });
await sleep(5000);
ok(!/Cannot GET|Application error/i.test(await page.content()), 'bundle served');

console.log('\n▸ 3. reach the sign-in screen');
// Onboarding is a carousel; press its CTA until the login form appears.
for (let i = 0; i < 6; i += 1) {
  if (await page.$('[data-testid="login-email"]')) break;
  const cta = await page.$('[data-testid="onboarding-cta"]');
  if (!cta) break;
  await cta.click().catch(() => {});
  await sleep(1100);
}
await sleep(1200);
const onLogin = Boolean(await page.$('[data-testid="login-email"]'));
ok(onLogin, 'landed on LOGIN (not sign-up) after onboarding');

console.log('\n▸ 4. the Google button');
const gBtn = await page.evaluate(() => {
  const els = [...document.querySelectorAll('*')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 40 && r.height > 20 && /Google|جوجل|جووجل/i.test(el.innerText || '');
  });
  const leaf = els[els.length - 1];
  if (!leaf) return null;
  const r = leaf.getBoundingClientRect();
  return { text: leaf.innerText.trim().slice(0, 60), x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
ok(Boolean(gBtn), gBtn ? `visible — "${gBtn.text}"` : 'NOT RENDERED');

console.log('\n▸ 5. what the button actually opens');
if (gBtn) {
  const opened = new Promise((resolve) => {
    browser.once('targetcreated', async (t) => resolve(t.url()));
    setTimeout(() => resolve(null), 12000);
  });
  await page.mouse.click(gBtn.x, gBtn.y, { delay: 40 });
  const url = await opened;
  if (url) {
    const u = new URL(url);
    ok(u.hostname.endsWith('google.com'), `popup → ${u.hostname}${u.pathname}`);
    const cid = u.searchParams.get('client_id') || '';
    const redir = u.searchParams.get('redirect_uri') || '';
    ok(cid === cfg.webClientId, `client_id matches the web client (${cid.slice(0, 20)}…)`);
    ok(redir === `${BASE}/app/`, `redirect_uri = ${redir}`);
    ok(u.searchParams.get('response_type')?.includes('id_token'), `response_type = ${u.searchParams.get('response_type')}`);
  } else {
    ok(false, 'no popup opened within 12s');
  }
}

console.log('\n▸ 6. email + password sign-in');
const p2 = await browser.newPage();
await p2.setViewport({ width: 480, height: 900 });
await p2.goto(`${BASE}/app/`, { waitUntil: 'networkidle2', timeout: 90000 });
await sleep(4500);
for (let i = 0; i < 6; i += 1) {
  if (await p2.$('[data-testid="login-email"]')) break;
  const cta = await p2.$('[data-testid="onboarding-cta"]');
  if (!cta) break;
  await cta.click().catch(() => {});
  await sleep(1100);
}
await sleep(1000);
if (await p2.$('[data-testid="login-email"]')) {
  await p2.type('[data-testid="login-email"]', EMAIL, { delay: 12 });
  await p2.type('[data-testid="login-password"]', PASS, { delay: 12 });
  await p2.click('[data-testid="login-submit"]');
  await sleep(8000);
  const txt = (await p2.evaluate(() => document.body.innerText || '')).replace(/\s+/g, ' ');
  ok(!/كلمة المرور غير صحيحة|بيانات الدخول|Invalid/i.test(txt), 'credentials accepted');
  ok(/الرئيسية|السجل|إحصائ/.test(txt), 'reached the signed-in app');
} else {
  ok(false, 'login form never appeared');
}

if (failures.length) {
  console.log('\n▸ runtime errors');
  for (const f of [...new Set(failures)].slice(0, 8)) console.log('   ⚠', f);
}

await browser.close();
console.log('');
