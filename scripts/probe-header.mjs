/**
 * The header must be ONE row at every width.
 *
 * `.hdr-in` is `flex-wrap: wrap`, which was a deliberate choice back when the
 * row held a brand and two buttons: wrapping is friendlier than overflowing.
 * The row has since gained a language pill, a theme pill, a social cluster and
 * a sixth nav link, and wrapping stopped being a graceful fallback and became
 * the normal state — a two-storey header with the navigation stranded above
 * the controls.
 *
 * Height is the measurement that catches it. A single row is ~68px; the moment
 * anything wraps it roughly doubles. So rather than eyeball a screenshot at one
 * window size, this walks the widths and reports the height at each, including
 * the exact point where it breaks.
 *
 *   node scripts/probe-header.mjs [baseUrl]
 */

import puppeteer from 'puppeteer-core';

const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:8899';

/** One row of Cairo at this size, plus the padding. Two rows blow past it. */
const MAX_ROW_PX = 86;

const WIDTHS = [360, 390, 430, 520, 620, 768, 900, 1024, 1170, 1190, 1280, 1366, 1440, 1600];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failed = [];

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars', '--lang=ar-EG'],
});
const page = await browser.newPage();

console.log('\n  width   height  rows  nav  social  burger   verdict');
console.log('  ─────   ──────  ────  ───  ──────  ──────   ───────');

for (const w of WIDTHS) {
  await page.setViewport({ width: w, height: 900 });
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await sleep(420);

  const m = await page.evaluate(() => {
    const seen = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden';
    };
    const inner = document.querySelector('.hdr-in');
    const r = inner.getBoundingClientRect();

    /* How many rows the flex children actually occupy.
       Clustered on the vertical CENTRE, not the top: `align-items:center`
       gives children of different heights different `top` values on the very
       same row, which made an earlier version of this probe report two rows
       for a perfectly good single-row header. A 16px tolerance separates
       "centred together" from "stacked". */
    const centres = [...inner.children]
      .filter(seen)
      .map((el) => { const b = el.getBoundingClientRect(); return b.top + b.height / 2; })
      .sort((a, b) => a - b);
    let rows = centres.length ? 1 : 0;
    for (let i = 1; i < centres.length; i += 1) {
      if (centres[i] - centres[i - 1] > 16) rows += 1;
    }

    /* Overlap, checked per PAIR of header children.
       `.hdr-in` reporting no overflow is not enough: a flex child that is
       allowed to shrink keeps the CONTAINER honest while its own contents
       spill over the neighbour. That is exactly how the nav came to sit on
       top of the wordmark at 1440px while this probe reported a clean single
       row — the container fit, the children did not. */
    const kids = [...inner.children].filter(seen);
    let overlap = 0;
    for (let i = 0; i < kids.length; i += 1) {
      for (let j = i + 1; j < kids.length; j += 1) {
        const a = kids[i].getBoundingClientRect();
        const b = kids[j].getBoundingClientRect();
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (x > 1 && y > 1) overlap = Math.max(overlap, Math.round(x));
      }
    }
    // And a child whose own content is wider than the box it was given.
    const squeezed = kids
      .filter((el) => el.scrollWidth - el.clientWidth > 1)
      .map((el) => `${el.className || el.tagName} by ${Math.round(el.scrollWidth - el.clientWidth)}px`);

    return {
      height: Math.round(r.height),
      rows,
      nav: seen(document.querySelector('header .nav')),
      social: seen(document.querySelector('.social-hdr')),
      burger: seen(document.getElementById('navBtn')),
      overflow: Math.round(inner.scrollWidth - inner.clientWidth),
      overlap,
      squeezed,
    };
  });

  const oneRow = m.rows <= 1 && m.height <= MAX_ROW_PX;
  // Exactly one of the two navigations must be reachable, always.
  const navOk = m.nav !== m.burger;
  const good = oneRow && navOk && m.overflow <= 1 && m.overlap === 0 && m.squeezed.length === 0;
  if (!good) {
    failed.push(
      `${w}px: rows=${m.rows} height=${m.height} overflow=${m.overflow} `
      + `overlap=${m.overlap}px squeezed=[${m.squeezed.join(', ')}] nav=${m.nav} burger=${m.burger}`,
    );
  }

  console.log(
    `  ${String(w).padStart(5)}   ${String(m.height).padStart(6)}  ${String(m.rows).padStart(4)}`
    + `  ${m.nav ? ' ✓ ' : ' · '}  ${m.social ? '  ✓   ' : '  ·   '}  ${m.burger ? '  ✓   ' : '  ·   '}`
    + `  ${good ? '✅' : '❌'}`,
  );
}

await browser.close();
if (failed.length) {
  console.log('\nFAILED:');
  for (const f of failed) console.log('  ' + f);
  console.log('');
} else {
  console.log('\nheader is a single row at every width\n');
}
process.exit(failed.length ? 1 : 0);
