/**
 * Recapture the fourteen product screenshots the landing gallery uses.
 *
 * Separate from `capture-app-shots.mjs`, which produces the numbered Play
 * Console set. This one exists because the landing page names its images by
 * what they SHOW (`meeting-live.png`), and the store set names them by the
 * order Play displays them (`05-meeting-joining.png`). Two audiences, two
 * orderings, one app — so two scripts rather than one with a rename table that
 * nobody would keep in step.
 *
 * These must be genuine. The landing page says "لقطة حقيقية من التطبيق" under
 * every one of them, and Play rejects mocked UI outright.
 *
 *   node scripts/capture-landing-shots.mjs            # everything
 *   node scripts/capture-landing-shots.mjs --no-call  # skip the metered ones
 *
 * The meeting shots cost real minutes from the account being driven, because
 * the meter is server-side and does not care that a robot is holding the call
 * open. `--no-call` re-shoots the free screens only.
 */

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'landing', 'shots');
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const APP = process.env.APP_URL || 'https://interview.khaledahmed.net/app/';
const API = process.env.API_URL || 'https://interview.khaledahmed.net/api';
const EMAIL = process.env.SHOT_EMAIL || 'reviewer@interprova.app';
const PASS = process.env.SHOT_PASS || 'InterprovaReview#2026';
const NO_CALL = process.argv.includes('--no-call');
// A distinct install id per capture account: the free trial is claimed against
// it, so reusing one would leave the second account with no minutes and the
// call screenshots would capture the paywall instead of the interview.
const SHOT_IID = process.env.SHOT_IID || 'landing-shots';

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

/* ------------------------------------------------------------------ *
 * Session
 * ------------------------------------------------------------------ */

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Install-Id': SHOT_IID },
  body: JSON.stringify({ email: EMAIL, password: PASS }),
}).then((r) => r.json());
if (!login?.token) throw new Error(`login failed: ${JSON.stringify(login).slice(0, 200)}`);

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--use-fake-ui-for-media-stream',     // auto-accept camera/mic
    '--use-fake-device-for-media-stream', // synthetic camera feed
    '--autoplay-policy=no-user-gesture-required',
    '--hide-scrollbars',
    '--font-render-hinting=none',
    '--lang=ar-EG',
  ],
});

const page = await browser.newPage();
// 540x960 @2x = 1080x1920, the size Play wants and the size the landing's
// device frame is cut for.
await page.setViewport({ width: 540, height: 960, deviceScaleFactor: 2 });
await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36');

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const kb = Math.round(fs.statSync(path.join(OUT, `${name}.png`)).size / 1024);
  log(`   📸 ${name}.png  ${kb}KB`);
};

const seen = (needle, ms = 25_000) => page.waitForFunction(
  (n) => document.body.innerText.includes(n), { timeout: ms }, needle,
).then(() => true).catch(() => false);

/** Tap the last (innermost) short element whose text contains `needle`. */
const tap = async (needle) => {
  const box = await page.evaluate((n) => {
    const hits = [...document.querySelectorAll('div,span,a,button')]
      .filter((e) => (e.textContent || '').trim().includes(n))
      .filter((e) => (e.textContent || '').trim().length < 80)
      .filter((e) => e.getBoundingClientRect().width > 0);
    const el = hits[hits.length - 1];
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, needle);
  if (!box) { log(`   ⚠ not found: ${needle}`); return false; }
  await page.mouse.click(box.x, box.y);
  await sleep(1200);
  return true;
};

/**
 * Tap a control-bar button by its caption.
 *
 * The bar draws a circular icon with the label BELOW it, and the label is not
 * inside the pressable — clicking the label's centre lands on dead space and
 * silently does nothing, which is how the camera stayed on through a capture
 * that had explicitly turned it off. Aim one icon-height above the caption.
 */
const tapControl = async (caption) => {
  const box = await page.evaluate((c) => {
    const label = [...document.querySelectorAll('div,span')]
      .filter((e) => (e.textContent || '').trim() === c)
      .filter((e) => e.getBoundingClientRect().width > 0)
      .pop();
    if (!label) return null;
    const r = label.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y - r.height * 1.6 };
  }, caption);
  if (!box || box.y < 0) { log(`   ⚠ control not found: ${caption}`); return false; }
  await page.mouse.click(box.x, box.y);
  await sleep(1200);
  return true;
};

const goHome = async () => {
  await page.goto(APP, { waitUntil: 'networkidle0', timeout: 90_000 });
  await seen('اختر مجالك');
  await sleep(1200);
};

/* ------------------------------------------------------------------ *
 * 1. Signed out — onboarding
 * ------------------------------------------------------------------ */

log('\n▸ onboarding');
await page.goto(APP, { waitUntil: 'networkidle0', timeout: 90_000 });
await seen('تخطي');
await sleep(1500);
await shot('onboarding');

/* ------------------------------------------------------------------ *
 * 2. Signed in
 * ------------------------------------------------------------------ */

await page.evaluateOnNewDocument((tok, iid) => {
  localStorage.setItem('access_token', tok);
  localStorage.setItem('install_id', iid);
}, login.token, SHOT_IID);

log('\n▸ home');
await goHome();
await shot('app-home');

for (const [name, label, needle] of [
  ['history', 'السجل', 'السجل'],
  ['stats', 'إحصائياتي', 'إحصائ'],
]) {
  log(`\n▸ ${name}`);
  await goHome();
  if (await tap(label)) { await seen(needle); await sleep(1500); await shot(name); }
}

log('\n▸ premium');
await goHome();
if (await tap('حسابي')) {
  await sleep(1000);
  if (await tap('شراء دقائق')) { await seen('رصيدك'); await sleep(2000); await shot('premium'); }
}

log('\n▸ ledger');
if (await tap('كشف حساب الدقائق')) { await seen('رصيد'); await sleep(1500); await shot('ledger'); }

log('\n▸ session summary');
await goHome();
if (await tap('السجل')) {
  await sleep(1200);
  const opened = await page.evaluate(() => {
    const row = [...document.querySelectorAll('div')]
      .find((e) => /من 10|٪/.test(e.textContent || '') && (e.textContent || '').length < 200);
    if (!row) return false;
    row.scrollIntoView({ block: 'center' });
    const r = row.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (opened) { await page.mouse.click(opened.x, opened.y); await sleep(2500); }
  await shot('session-summary');
}

/* ------------------------------------------------------------------ *
 * 3. The interview — metered, so last and skippable
 * ------------------------------------------------------------------ */

if (NO_CALL) {
  log('\n▸ call screens skipped (--no-call)');
} else {
  log('\n▸ interview setup');
  await goHome();
  if (await tap('مقابلة مباشرة')) {
    await seen('لغة المقابلة');
    await sleep(1500);
    await shot('setup-language');

    await page.evaluate(() => window.scrollBy(0, 700));
    await sleep(600);
    await tap('برمجة');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(900);
    await shot('setup-details');

    log('\n▸ lobby');
    if (await tap('ابدأ المقابلة المحاكاة')) {
      await seen('جاهزة للبدء', 30_000);
      await sleep(2000);
      await shot('meeting-lobby');

      log('\n▸ live');
      if (await tap('ابدأ المقابلة مع')) {
        // Wait for the interviewer's first line rather than a fixed sleep —
        // the model call is the slow part and it is not a constant.
        await seen('مسؤولة الموارد البشرية', 40_000);
        await sleep(6000);

        // Camera OFF before every capture. `--use-fake-device-for-media-stream`
        // feeds Chrome's synthetic test pattern — a flat green rectangle with a
        // timecode — and a marketing screenshot showing that is worse than one
        // showing the honest camera-off tile. There is no real face to put in
        // the self-view on a headless build, and inventing one would be a
        // mocked screenshot, which Play rejects.
        await tapControl('الكاميرا');
        await sleep(2500);
        await shot('meeting-live');

        log('\n▸ tips');
        if (await tapControl('نصائح')) { await sleep(1800); await shot('meeting-tips'); await tap('إغلاق') || await page.keyboard.press('Escape'); }

        log('\n▸ recording');
        if (await tapControl('تسجيل')) { await sleep(2500); await shot('meeting-recording'); await tapControl('تسجيل'); }

        log('\n▸ end');
        await sleep(1000);
        if (await tapControl('إنهاء')) { await sleep(1500); await shot('meeting-end'); await tap('إنهاء'); }
      }
    }
  }
}

await browser.close();
log('\n✔ done →', OUT);
