/**
 * Render the brand assets that contain Arabic text, using a real browser.
 *
 * Pillow cannot do this correctly. Arabic needs contextual shaping and bidi
 * reordering, and Pillow only has those when it is built against libraqm —
 * which this machine's build is not. The usual workaround (arabic-reshaper +
 * python-bidi) maps letters to the Arabic Presentation Forms-B block, and
 * Cairo does not contain that block at all: it ships only the base codepoints
 * and expects an OpenType shaper. The result was "ثقتي" rendering as "يتقث"
 * with tofu boxes wherever a shadda or hamza appeared.
 *
 * A browser has a full OpenType shaper (HarfBuzz) and the real Cairo font, so
 * rendering the text there and screenshotting it is both correct and simpler
 * than reimplementing shaping.
 *
 *   node scripts/render-text-assets.mjs
 */

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EDGE = process.env.EDGE_PATH
  || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const FONT_REG = path.join(ROOT, 'mobile/assets/fonts/Cairo-Regular.ttf');
const FONT_BOLD = path.join(ROOT, 'mobile/assets/fonts/Cairo-Bold.ttf');
// The dark-ground variant: white front bubble, gold outline behind. Painting
// the flat mark white instead would merge the two bubbles into one shape.
const MARK = path.join(ROOT, 'landing/logo-mark-ondark.png');

const b64 = (p) => fs.readFileSync(p).toString('base64');

// Embedding the font and mark as data URIs keeps rendering deterministic and
// offline — no network fetch can change how a shipped asset looks.
const fontCss = `
@font-face{font-family:'Cairo';font-weight:400;src:url(data:font/ttf;base64,${b64(FONT_REG)}) format('truetype')}
@font-face{font-family:'Cairo';font-weight:700;src:url(data:font/ttf;base64,${b64(FONT_BOLD)}) format('truetype')}
`;
const markSrc = `data:image/png;base64,${b64(MARK)}`;

const BRAND = '#2D73FD';
const NAVY = '#0A1A4A';
const GOLD = '#FEAF04';

function page({ w, h, body, extra = '' }) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
${fontCss}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${w}px;height:${h}px;overflow:hidden}
body{font-family:'Cairo',sans-serif;-webkit-font-smoothing:antialiased;
  background:linear-gradient(135deg,${BRAND} 0%,${NAVY} 100%);
  color:#fff;position:relative}
.glow{position:absolute;border-radius:50%;filter:blur(90px);opacity:.5}
${extra}
</style></head><body>${body}</body></html>`;
}

/**
 * The social card and the Play feature graphic.
 *
 * Centred, not split left/right. Play crops the feature graphic differently
 * across surfaces, and anything pushed to an edge can be cut; the safe area is
 * the middle. The copy is descriptive only — the previous version read
 * "ثقتي — أول مدرّب مقابلات عربي بالذكاء الاصطناعي" and Google rejected the
 * app under the Metadata policy for the superlative "أول" (first). No claim
 * about rank, popularity or outcome may appear in this file again.
 */
const OG = ({ w, h }) => page({
  w, h,
  extra: `
  .wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
    justify-content:center;gap:${Math.round(h * 0.038)}px;padding:0 ${Math.round(w * 0.07)}px}
  .lockup{display:flex;direction:ltr;align-items:center;gap:${Math.round(w * 0.022)}px}
  .lockup img{width:${Math.round(h * 0.155)}px}
  .word{font-weight:700;font-size:${Math.round(h * 0.105)}px;line-height:1;letter-spacing:-.025em;direction:ltr}

  /* The headline. Arabic, so it must never be given direction:ltr — the
     wordmark above is Latin and gets it, this does not. Held to two lines by
     an explicit <br> rather than by wrapping, because a wrap point chosen by
     the browser can orphan a single word onto line two. */
  h1{font-weight:700;font-size:${Math.round(h * 0.098)}px;line-height:1.42;
     text-align:center;letter-spacing:-.015em;max-width:${Math.round(w * 0.84)}px}
  h1 .hl{color:${GOLD}}

  /* Three claims, each one a fact about what the product does. Pills rather
     than a sentence: at the size a share card is actually seen — a 320px-wide
     thumbnail in a chat list — a line of prose is unreadable and a row of
     short chips still parses. */
  .pills{display:flex;direction:rtl;gap:${Math.round(w * 0.014)}px;flex-wrap:nowrap}
  .pill{display:flex;align-items:center;gap:${Math.round(w * 0.007)}px;
    padding:${Math.round(h * 0.021)}px ${Math.round(w * 0.021)}px;border-radius:999px;
    background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.20);
    font-size:${Math.round(h * 0.043)}px;font-weight:600;color:#EAF2FF;white-space:nowrap}
  .dot{width:${Math.round(h * 0.018)}px;height:${Math.round(h * 0.018)}px;border-radius:50%;
    background:${GOLD};flex:0 0 auto}

  .foot{display:flex;align-items:center;gap:${Math.round(w * 0.012)}px;direction:ltr;
    font-size:${Math.round(h * 0.042)}px;font-weight:600;color:#9FC0F5;letter-spacing:.01em}
  .rule{width:${Math.round(w * 0.07)}px;height:${Math.max(3, Math.round(h * 0.008))}px;
    background:${GOLD};border-radius:99px}
  `,
  body: `
  <div class="glow" style="width:${w * 0.42}px;height:${w * 0.42}px;background:${GOLD};top:${-h * 0.35}px;left:${-w * 0.08}px"></div>
  <div class="glow" style="width:${w * 0.34}px;height:${w * 0.34}px;background:#4F8BFF;bottom:${-h * 0.30}px;right:${-w * 0.06}px"></div>
  <div class="wrap">
    <div class="lockup">
      <img src="${markSrc}" alt="">
      <div class="word">Interprova</div>
    </div>
    <div class="rule"></div>
    <h1>تدرَّب على مقابلة العمل بالعربية<br><span class="hl">قبل أن تدخلها فعلاً</span></h1>
    <div class="pills">
      <span class="pill"><span class="dot"></span>محاوِر ذكاء اصطناعي</span>
      <span class="pill"><span class="dot"></span>تقييم فوري من ١٠</span>
      <span class="pill"><span class="dot"></span>عربي وإنجليزي</span>
    </div>
    <div class="foot">interprova.com</div>
  </div>`,
});

const SPLASH = ({ w, h }) => page({
  w, h,
  extra: `
  .wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(h * 0.035)}px}
  img{width:${Math.round(w * 0.42)}px}
  .ar{font-weight:700;font-size:${Math.round(w * 0.125)}px;line-height:1.15;letter-spacing:-.025em;direction:ltr}
  .la{font-weight:600;font-size:${Math.round(w * 0.048)}px;color:rgba(255,255,255,.76)}
  `,
  body: `
  <div class="wrap">
    <img src="${markSrc}" alt="">
    <div class="ar">Interprova</div>
    <div class="la">تدريب مقابلات العمل</div>
  </div>`,
});

/**
 * The share card is emitted under a VERSIONED name.
 *
 * `og-image.png` was pinned — never content-hashed — so that links already
 * shared kept a working preview across deploys. That reasoning is sound and
 * still holds, but it has a cost that came due: the pinned URL was fetched by
 * WhatsApp, Facebook and X while the card was still being rendered by Pillow,
 * which cannot shape Arabic. Those scrapers cached a picture of broken
 * letterforms and, addressing the same URL forever, never looked again.
 *
 * A cache can only be broken by changing the address, so the card the meta
 * tags point at is `og-image-v2.png`. The old name is kept on disk, holding
 * the SAME corrected bytes: nothing that ever linked to it 404s, and any
 * scraper that does revalidate gets the good image. Bumping the version is the
 * documented way to force a refetch — it should be rare, and each bump costs
 * the preview on links shared before it.
 */
const OG_CARD = 'landing/og-image-v2.png';
/** Kept in step with OG_CARD so old links resolve to the corrected card. */
const OG_ALIAS = 'landing/og-image.png';

const shots = [
  { name: OG_CARD,                            w: 1200, h: 630,  html: OG,     scale: 1 },
  { name: 'store-assets/feature-graphic.png', w: 1024, h: 500,  html: OG,     scale: 1 },
  { name: 'mobile/assets/splash.png',         w: 621,  h: 1344, html: SPLASH, scale: 2 },
];

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars', '--font-render-hinting=none'],
});

for (const s of shots) {
  const p = await browser.newPage();
  await p.setViewport({ width: s.w, height: s.h, deviceScaleFactor: s.scale });
  await p.setContent(s.html({ w: s.w, h: s.h }), { waitUntil: 'load' });
  await p.evaluateHandle('document.fonts.ready');
  const out = path.join(ROOT, s.name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await p.screenshot({ path: out });
  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(`  ${s.name}  ${s.w * s.scale}x${s.h * s.scale}  ${kb}KB`);
  await p.close();
}

await browser.close();

// The alias is a copy, not a symlink: the deploy tars the tree and a link
// would either be followed (duplicating anyway) or arrive broken.
fs.copyFileSync(path.join(ROOT, OG_CARD), path.join(ROOT, OG_ALIAS));
console.log(`  ${OG_ALIAS}  (alias of ${path.basename(OG_CARD)}, for links already shared)`);

console.log('done');
