/**
 * Prove the mobile navigation actually works, at the widths it exists for.
 *
 * The bug it guards against was not subtle — `.nav{display:none}` under 1080px
 * with nothing in its place, so a phone had no route to thirteen of the
 * fourteen pages — but it was invisible on a desktop, which is where the site
 * was always looked at. So this checks the phone case explicitly, on every
 * generated page rather than just the homepage, since the header is copied
 * onto all of them by build-site.mjs and could be copied wrong.
 *
 *   node scripts/probe-nav.mjs [baseUrl]
 */

import puppeteer from 'puppeteer-core';

const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:8899';
const PAGES = ['/index.html', '/pricing.html', '/faq.html', '/blog.html', '/contact.html'];
// 1180 is the breakpoint; 1170/1190 straddle it so a change to one of the
// two rules without the other is caught immediately.
const WIDTHS = [360, 768, 1024, 1170, 1190, 1440];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { if (!c) failed.push(m); console.log(`  ${c ? '✅' : '❌'} ${m}`); };
const failed = [];

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars', '--lang=ar-EG'],
});
const page = await browser.newPage();

console.log('\n▸ the button appears exactly where the nav disappears');
for (const w of WIDTHS) {
  await page.setViewport({ width: w, height: 800 });
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await sleep(450);
  const s = await page.evaluate(() => {
    const seen = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden';
    };
    return {
      btn: seen(document.getElementById('navBtn')),
      nav: seen(document.querySelector('header .nav')),
    };
  });
  // Exactly one of the two must be reachable at every width — never both, and
  // never neither, which was the shipped state on every phone.
  ok(s.btn !== s.nav, `${w}px — burger:${s.btn ? 'yes' : 'no'} inline-nav:${s.nav ? 'yes' : 'no'}`);
}

console.log('\n▸ it opens, lists the site, and closes');
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle2' });
await sleep(700);
await page.click('#navBtn');
await sleep(600);

const opened = await page.evaluate(() => {
  const d = document.getElementById('navDrawer');
  const r = d.getBoundingClientRect();
  return {
    onScreen: r.left >= -1 && r.right <= innerWidth + 1 && r.width > 100,
    expanded: document.getElementById('navBtn').getAttribute('aria-expanded'),
    links: [...d.querySelectorAll('.drawer-nav a')].map((a) => a.getAttribute('href')),
    locked: getComputedStyle(document.body).overflow,
    scrim: !document.getElementById('navScrim').hidden,
  };
});
ok(opened.onScreen, 'drawer is fully on screen');
ok(opened.expanded === 'true', `aria-expanded = ${opened.expanded}`);
ok(opened.links.length >= 7, `${opened.links.length} links: ${opened.links.join(' ')}`);
ok(opened.locked === 'hidden', 'page behind is scroll-locked');
ok(opened.scrim, 'scrim shown');

await page.screenshot({ path: process.env.NAV_SHOT || 'C:/Users/KHALE/AppData/Local/Temp/claude/f--InterviewAI-Arabia/b3bd4620-e449-4360-b207-11d3090bd8ce/scratchpad/nav-drawer.png' });

await page.keyboard.press('Escape');
await sleep(600);
const closed = await page.evaluate(() => ({
  hidden: document.getElementById('navDrawer').hidden,
  expanded: document.getElementById('navBtn').getAttribute('aria-expanded'),
  locked: getComputedStyle(document.body).overflow,
}));
ok(closed.hidden, 'Escape hides it (not merely transparent — it must not eat taps)');
ok(closed.expanded === 'false', 'aria-expanded back to false');
ok(closed.locked !== 'hidden', 'scroll released');

console.log('\n▸ every generated page carries it');
for (const p of PAGES) {
  await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded' });
  await sleep(400);
  const good = await page.evaluate(() => {
    const b = document.getElementById('navBtn');
    if (!b) return false;
    const r = b.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  });
  ok(good, `${p}`);
}

console.log('\n▸ a link inside it actually navigates');
await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle2' });
await sleep(600);
await page.click('#navBtn');
await sleep(500);
await Promise.all([
  page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
  page.evaluate(() => document.querySelector('.drawer-nav a[href="/pricing.html"]').click()),
]);
await sleep(600);
ok(/pricing/.test(page.url()), `landed on ${page.url().replace(BASE, '')}`);

await browser.close();
console.log(failed.length ? `\n${failed.length} FAILED\n` : '\nall good\n');
process.exit(failed.length ? 1 : 0);
