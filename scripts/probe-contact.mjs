/**
 * Send a real message through the real contact form, in a real browser.
 *
 * The curl-level tests prove the bot defences REJECT things. They cannot prove
 * the honest path works, because the honest path requires a reCAPTCHA token
 * and only a browser executing Google's script can mint one. So this drives the
 * live page: it fills the form like a person, waits past the minimum-fill
 * window, submits, and then reads the server's own answer.
 *
 * A pass here means the whole chain held: page → config → Google → our verify →
 * SMTP → the inbox. Anything less than that is a form that "looks" like it
 * works, which is the exact failure this is here to rule out.
 *
 *   node scripts/probe-contact.mjs [baseUrl]
 */

import puppeteer from 'puppeteer-core';

const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.argv[2] || 'https://interprova.com';
const STAMP = new Date().toISOString().replace('T', ' ').slice(0, 19);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failed = [];
const ok = (c, m) => { if (!c) failed.push(m); console.log(`  ${c ? '✅' : '❌'} ${m}`); };

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--no-sandbox', '--lang=ar-EG', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 480, height: 900, deviceScaleFactor: 2 });

// Watch the actual request, so a pass cannot be a UI message with no POST
// behind it — and so a failure reports the server's reason, not "it went red".
let posted = null;
page.on('response', async (res) => {
  if (!res.url().endsWith('/api/contact')) return;
  posted = { status: res.status(), body: await res.text().catch(() => '') };
});

console.log(`\n▸ ${BASE}/contact.html`);
await page.goto(`${BASE}/contact.html`, { waitUntil: 'networkidle2', timeout: 90000 });
await sleep(2500);

ok(Boolean(await page.$('#contact-form')), 'form present');
ok(Boolean(await page.$('#c-website')), 'honeypot present');

const notice = await page.evaluate(() => {
  const n = document.querySelector('.recaptcha-note');
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return { text: (n.innerText || '').trim().slice(0, 70), visible: r.width > 2 && r.height > 2 };
});
// Google's terms allow hiding the floating badge only if this is shown.
ok(Boolean(notice?.visible), `reCAPTCHA attribution visible — "${notice?.text || 'MISSING'}"`);

const scriptLoaded = await page.evaluate(() => Boolean(window.grecaptcha));
ok(scriptLoaded, 'grecaptcha script loaded from the fetched site key');

console.log('\n▸ filling it in like a person');
await page.type('#c-name', 'اختبار Interprova', { delay: 25 });
await page.type('#c-email', 'khaledahmedhaggagy@gmail.com', { delay: 20 });
await page.select('#c-topic', 'support');
await page.type('#c-message',
  `رسالة اختبار آلية من probe-contact.mjs بتاريخ ${STAMP}. `
  + 'إن وصلت هذه الرسالة إلى info@interprova.com فالنموذج يعمل من طرف إلى طرف: '
  + 'الصفحة، وreCAPTCHA، والتحقّق على الخادم، والإرسال عبر SMTP.',
  { delay: 8 });

// Past MIN_FILL_MS, which the server enforces. Typing above already takes a
// while; this makes the margin explicit rather than incidental.
await sleep(3500);

console.log('\n▸ submitting');
await page.click('#c-submit');
await page.waitForFunction(
  () => { const m = document.getElementById('c-msg'); return m && m.className.indexOf('show') !== -1; },
  { timeout: 45000 },
).catch(() => {});
await sleep(2000);

const result = await page.evaluate(() => {
  const m = document.getElementById('c-msg');
  return { text: (m?.innerText || '').trim(), cls: m?.className || '' };
});

ok(Boolean(posted), 'a POST /api/contact actually happened');
if (posted) ok(posted.status === 200, `server replied ${posted.status} ${posted.body.slice(0, 160)}`);
ok(/ok/.test(result.cls) && !/err/.test(result.cls), `page says: "${result.text}"`);

await browser.close();
console.log(failed.length ? `\n${failed.length} FAILED\n` : '\nsent — now check info@interprova.com\n');
process.exit(failed.length ? 1 : 0);
