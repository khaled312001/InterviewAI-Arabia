/**
 * Capture real product screenshots by driving the live web build of the app.
 *
 * These are used in two places and both need to be genuine — the landing page
 * shows what the product actually looks like, and Google Play rejects mocked-up
 * UI that misrepresents the app.
 *
 * A headless browser is given a synthetic camera and microphone
 * (--use-fake-device-for-media-stream) so the meeting screen reaches its real
 * states instead of stalling on a permission prompt. The interviewer speaks
 * first, so the live/caption states are reachable without simulating the
 * candidate's own speech.
 *
 *   node scripts/capture-app-shots.mjs           # capture everything
 *   node scripts/capture-app-shots.mjs --explore # dump selectors, don't save
 *
 * Output: 1080x1920 PNGs (540x960 @2x) — the size Play wants for phone shots.
 */

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'store-assets', 'phone');
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const APP = process.env.APP_URL || 'https://interview.khaledahmed.net/app';
const EMAIL = process.env.SHOT_EMAIL || 'reviewer@thiqty.app';
const PASS = process.env.SHOT_PASS || 'ThiqtyReview#2026';
const EXPLORE = process.argv.includes('--explore');
// The live meeting consumes AI quota; skip it to re-shoot only the rest.
const SKIP_MEETING = process.argv.includes('--no-meeting');

fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--use-fake-ui-for-media-stream',      // auto-accept camera/mic
    '--use-fake-device-for-media-stream',  // synthetic camera feed
    '--autoplay-policy=no-user-gesture-required',
    '--hide-scrollbars',
    '--font-render-hinting=none',
    '--lang=ar-EG',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 540, height: 960, deviceScaleFactor: 2 });
await page.setExtraHTTPHeaders({ 'Accept-Language': 'ar-EG,ar;q=0.9' });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

let n = 0;
async function shot(name) {
  n += 1;
  const file = path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  const kb = Math.round(fs.statSync(file).size / 1024);
  log(`   📸 ${path.basename(file)}  ${kb}KB`);
  return file;
}

/** Everything the user can see, flattened — react-native-web nests heavily. */
async function visibleText() {
  return page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim());
}

async function dump(tag) {
  const info = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden';
    };
    return [...document.querySelectorAll('[role="button"],button,[data-testid],a,input')]
      .filter(vis)
      .map((el) => ({
        id: el.getAttribute('data-testid') || '',
        text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 50),
      }))
      .filter((e) => e.text || e.id)
      .slice(0, 45);
  });
  log(`  ── ${tag} ──`);
  log('     text:', (await visibleText()).slice(0, 320));
  for (const c of info) log(`     [${c.id || 'btn'}] ${c.text}`);
}

/** Click the first visible element whose text matches. Returns what it clicked. */
async function clickText(re, { timeout = 12000 } = {}) {
  const src = re.source;
  const flags = re.flags.replace('g', '');
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const hit = await page.evaluateHandle((s, f) => {
      const rx = new RegExp(s, f);
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden';
      };
      // Not just [role=button] — react-native-web renders plenty of tappable
      // things (text links, icon buttons) as plain divs, so scan everything and
      // rely on the click bubbling up to whichever ancestor holds the handler.
      const els = [...document.querySelectorAll('*')].filter(vis);
      const matches = els.filter((el) => {
        const t = (el.innerText || el.getAttribute('aria-label') || '').trim();
        return t.length < 140 && rx.test(t);
      });
      // Keep only leaves — a screen container "contains" every string in it.
      const leaves = matches.filter((el) => !matches.some((o) => o !== el && el.contains(o)));
      return leaves.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0] || null;
    }, src, flags);
    const el = hit.asElement();
    if (el) {
      const txt = await page.evaluate((e) => {
        e.scrollIntoView({ block: 'center', behavior: 'instant' });
        return (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 40);
      }, el);
      await sleep(350);
      // A synthesised mouse click at the element's centre — react-native-web
      // Pressables listen for pointer events on an ancestor, and clicking the
      // text node directly does not always reach them.
      const box = await el.boundingBox();
      if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 40 });
      else await el.click().catch(() => {});
      log(`   → clicked "${txt}"`);
      return txt;
    }
    await sleep(400);
  }
  log(`   ⚠ no element matching ${re}`);
  return null;
}

/**
 * Click a meeting control by its caption. The caption is a separate text node
 * under the pressable, so clicking it directly can miss the handler — walk up
 * to the nearest ancestor that is actually a button.
 */
async function clickControl(label) {
  const hit = await page.evaluateHandle((name) => {
    const els = [...document.querySelectorAll('*')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2 && (el.innerText || '').trim() === name;
    });
    const leaf = els[els.length - 1];
    if (!leaf) return null;
    let node = leaf;
    for (let i = 0; i < 4 && node.parentElement; i += 1) {
      node = node.parentElement;
      if (node.getAttribute('role') === 'button' || node.tagName === 'BUTTON') return node;
    }
    return leaf.parentElement || leaf;
  }, label);
  const el = hit.asElement();
  if (!el) { log(`   ⚠ control "${label}" not found`); return false; }
  const box = await el.boundingBox();
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 40 });
  log(`   → control "${label}"`);
  return true;
}

async function waitText(re, { timeout = 30000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (re.test(await visibleText())) return true;
    await sleep(500);
  }
  log(`   ⚠ timed out waiting for ${re}`);
  return false;
}

// ── 1. Onboarding ──────────────────────────────────────────────────────────
log('\n▸ Onboarding');
await page.goto(APP, { waitUntil: 'networkidle2', timeout: 90000 });
await sleep(4500);
if (EXPLORE) await dump('onboarding');
await shot('onboarding');

// ── 2. Sign in ─────────────────────────────────────────────────────────────
// Onboarding is a 3-slide carousel: the CTA reads "التالي" until the last
// slide, so it has to be pressed through rather than clicked once.
log('\n▸ Sign in');
for (let i = 0; i < 5; i += 1) {
  if (await page.$('[data-testid="login-email"]')) break;
  if (!(await page.$('[data-testid="onboarding"]'))) break;
  const cta = await page.$('[data-testid="onboarding-cta"]');
  if (!cta) break;
  await cta.click().catch(() => {});
  log(`   → onboarding cta (${i + 1})`);
  await sleep(1200);
}
await sleep(1500);
if (EXPLORE) await dump('after-onboarding');

// We may land on sign-up rather than sign-in.
if (!(await page.$('[data-testid="login-email"]'))) {
  await clickText(/سجّل الدخول|سجل الدخول|تسجيل الدخول|Log ?in|Sign ?in/i, { timeout: 8000 });
  await sleep(2000);
}
if (EXPLORE) await dump('login');
if (await page.$('[data-testid="login-email"]')) {
  await page.type('[data-testid="login-email"]', EMAIL, { delay: 15 });
  await page.type('[data-testid="login-password"]', PASS, { delay: 15 });
  await shot('sign-in');
  await page.click('[data-testid="login-submit"]');
  log('   → submitted');
  await sleep(7000);
} else {
  log('   ⚠ login form not reached');
}

// ── 3. Home ────────────────────────────────────────────────────────────────
log('\n▸ Home');
await sleep(2500);
if (EXPLORE) await dump('home');
await shot('home');

if (!SKIP_MEETING) {
// ── 4. Categories / start a meeting ────────────────────────────────────────
log('\n▸ Meeting setup');
await clickText(/مقابلة|Meeting|ابدأ المقابلة/i, { timeout: 10000 });
await sleep(3000);
if (EXPLORE) await dump('setup');
await shot('interview-language');

// A field has to be chosen before the meeting can start.
await clickText(/^\s*برمجة/i, { timeout: 8000 });
await sleep(1200);

// The setup form gates the start button until the role is described, so fill
// it in — this also makes the screenshot show a realistic configured meeting
// rather than empty placeholders.
const SETUP_VALUES = ['شركة بَرمَجلي', 'مهندس برمجيات — Backend'];
const filled = await page.evaluate((vals) => {
  const inputs = [...document.querySelectorAll('input,textarea')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2 && el.type !== 'file';
  });
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  inputs.slice(0, vals.length).forEach((el, i) => {
    setter.call(el, vals[i]);                                  // React tracks value on the node
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return inputs.length;
}, SETUP_VALUES);
log(`   → filled ${Math.min(filled, SETUP_VALUES.length)} of ${filled} setup fields`);
await sleep(1200);
await shot('interview-setup');

// ── 5. Enter the meeting ───────────────────────────────────────────────────
log('\n▸ Entering meeting');
await clickText(/ابدأ المقابلة/i, { timeout: 10000 });
await sleep(3500);
if (EXPLORE) await dump('meeting-preparing');
// Chrome's synthetic camera is a bright green test card, which would look
// like a broken app in a store listing. Turning the camera off shows the
// real "camera off" placeholder instead — an honest state of the product.
if (!process.env.KEEP_FAKE_CAMERA) {
  await clickControl('الكاميرا');
  await sleep(2000);
}
await shot('meeting-lobby');

// ── 6. Actually start the interview ────────────────────────────────────────
// The lobby has its own start button; the previous screen only joined the room.
log('\n▸ Starting the interview');
await clickText(/ابدأ المقابلة مع/i, { timeout: 10000 });
log('   waiting for the interviewer to speak…');
await waitText(/جارٍ|يتحدث|تستمع|أهلاً|مرحب/i, { timeout: 45000 });
await sleep(6000);
if (EXPLORE) await dump('meeting-live');
await shot('meeting-live');

await sleep(8000);
await shot('meeting-captions');

// ── 7. Recording + tips ────────────────────────────────────────────────────
log('\n▸ Recording control');
await clickControl('تسجيل');
await sleep(3500);
await shot('meeting-recording');

log('\n▸ Tips panel');
await clickControl('نصائح');
await sleep(2500);
await shot('meeting-tips');
await page.keyboard.press('Escape').catch(() => {});
await sleep(1200);

// ── 8. End and evaluate ────────────────────────────────────────────────────
log('\n▸ Ending the meeting');
await clickControl('إنهاء');
await sleep(2500);
await shot('meeting-end-confirm');
// With a recording in flight the dialog offers save/discard; without one it
// is a single confirm. Discard here so the headless run does not trigger a
// download it cannot complete.
// Exact-match the button: the dialog TITLE is "إنهاء المقابلة؟", which a
// loose regex matches first and which does nothing when clicked.
if (!(await clickControl('إنهاء بدون حفظ التسجيل'))) await clickControl('إنهاء المقابلة');
log('   waiting for evaluation…');
await sleep(25000);
if (EXPLORE) await dump('summary');
await shot('evaluation');
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await sleep(1500);
await shot('evaluation-details');

}

// ── 9. The rest of the app ─────────────────────────────────────────────────
// The evaluation screen sits on top of the tab navigator; go home first.
for (const label of ['العودة', 'العودة للرئيسية', 'تم']) {
  if (await clickControl(label)) { await sleep(3500); break; }
}
await sleep(2000);
const TABS = [
  { re: /السجل|History/i, name: 'history' },
  { re: /إحصائيات|الإحصائيات|Stats/i, name: 'stats' },
  { re: /حسابي|الملف|Profile/i, name: 'profile' },
];
for (const tab of TABS) {
  log(`\n▸ ${tab.name}`);
  await clickText(tab.re, { timeout: 8000 });
  await sleep(3500);
  await shot(tab.name);
}

log('');
log('▸ Session summary');
await clickText(/^السجل$/, { timeout: 8000 });
await sleep(3000);
await clickText(/برمجة/, { timeout: 8000 });
await sleep(4500);
await shot('session-summary');
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await sleep(1800);
await shot('answer-feedback');

log('\n▸ Plans');
await clickText(/اشترك|الاشتراك|ترقية|Premium|Subscribe/i, { timeout: 8000 });
await sleep(3500);
await shot('premium');

if (errors.length) {
  log('\n⚠ page errors seen:');
  for (const e of [...new Set(errors)].slice(0, 8)) log('   ', e);
}

await browser.close();
log(`\n✔ ${n} screenshots in ${OUT}`);
