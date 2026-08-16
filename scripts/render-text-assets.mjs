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
const MARK = path.join(ROOT, 'landing/logo-mark.png');

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

const OG = ({ w, h }) => page({
  w, h,
  extra: `
  .wrap{position:absolute;inset:0;display:flex;align-items:center;justify-content:space-between;padding:0 ${Math.round(w * 0.075)}px;gap:${Math.round(w * 0.05)}px}
  .copy{text-align:right;flex:1}
  h1{font-weight:700;font-size:${Math.round(w * 0.058)}px;line-height:1.35;letter-spacing:-.02em}
  h1 .gold{color:${GOLD}}
  p{margin-top:${Math.round(h * 0.05)}px;font-size:${Math.round(w * 0.027)}px;color:#BFD7FE;letter-spacing:.02em}
  img{width:${Math.round(h * 0.5)}px;filter:brightness(0) invert(1);flex:0 0 auto}
  `,
  body: `
  <div class="glow" style="width:${w * 0.42}px;height:${w * 0.42}px;background:${GOLD};top:${-h * 0.35}px;left:${-w * 0.08}px"></div>
  <div class="wrap">
    <div class="copy">
      <h1><span class="gold">ثقتي</span> — أول مدرّب مقابلات<br>عربي بالذكاء الاصطناعي</h1>
      <p>تدرّب · اتقيّم · اتوظّف</p>
    </div>
    <img src="${markSrc}" alt="">
  </div>`,
});

const SPLASH = ({ w, h }) => page({
  w, h,
  extra: `
  .wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(h * 0.035)}px}
  img{width:${Math.round(w * 0.42)}px;filter:brightness(0) invert(1)}
  .ar{font-weight:700;font-size:${Math.round(w * 0.13)}px;line-height:1.2}
  .la{font-weight:700;font-size:${Math.round(w * 0.055)}px;color:rgba(255,255,255,.72);letter-spacing:.08em}
  `,
  body: `
  <div class="wrap">
    <img src="${markSrc}" alt="">
    <div class="ar">ثقتي</div>
    <div class="la">Thiqty</div>
  </div>`,
});

const shots = [
  { name: 'landing/og-image.png',            w: 1200, h: 630,  html: OG,     scale: 1 },
  { name: 'store-assets/feature-graphic.png', w: 1024, h: 500,  html: OG,     scale: 1 },
  { name: 'mobile/assets/splash.png',        w: 621,  h: 1344, html: SPLASH, scale: 2 },
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
console.log('done');
