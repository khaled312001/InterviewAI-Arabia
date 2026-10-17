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


/**
 * The English share card (og:image). English is the site's default language,
 * so this is what a shared link shows. Split layout: the claims on the left,
 * a picture of the product on the right — a real CV template thumbnail with
 * floating product cards. Same rule as above: describe what the product does;
 * no rank, popularity or outcome claims.
 */
const CV_THUMB = `data:image/webp;base64,${b64(path.join(ROOT, 'landing/shots/cv/infographic-en.webp'))}`;
const ICONS = {
  mic: '<path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1a7 7 0 0 0 6-6.9z"/>',
  live: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4.9 4.9l1.4 1.4a8 8 0 0 0 0 11.4l-1.4 1.4a10 10 0 0 1 0-14.2zm14.2 0a10 10 0 0 1 0 14.2l-1.4-1.4a8 8 0 0 0 0-11.4z"/>',
  cv: '<path d="M6 2h9l5 5v15H6zm8 1.5V8h4.5zM9 12h8v1.6H9zm0 3.4h8V17H9zm0-6.8h3.5v1.6H9z"/>',
  ats: '<path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5zm-1.2 14.2-3.5-3.5 1.4-1.4 2.1 2.1 4.8-4.8 1.4 1.4z"/>',
  jobs: '<path d="M9 4h6a2 2 0 0 1 2 2v1h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h3V6a2 2 0 0 1 2-2zm0 3h6V6H9z"/>',
  devices: '<path d="M2 5h16v9H2zm-1 11h18v1.5H1zM19 8h4v12h-4z"/>',
};
const ic = (k) => `<svg viewBox="0 0 24 24" fill="currentColor">${ICONS[k]}</svg>`;

const OG_EN = ({ w, h }) => page({
  w, h,
  extra: `
  body{background:radial-gradient(circle at 78% 40%, #3B7BFF 0, transparent 48%), linear-gradient(135deg, #1F5FE8 0%, ${NAVY} 72%)}
  .grid{position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.10) 1.2px, transparent 1.3px);background-size:22px 22px;
    -webkit-mask-image:linear-gradient(90deg, transparent 0%, #000 55%, #000 100%)}
  .left{position:absolute;left:64px;top:56px;bottom:50px;width:610px;display:flex;flex-direction:column;direction:ltr;text-align:left}
  .lockup{display:flex;align-items:center;gap:14px}
  .lockup img{width:58px}
  .word{font-weight:700;font-size:40px;letter-spacing:-.02em;line-height:1}
  .tag{margin-left:6px;padding:5px 12px;border-radius:999px;background:rgba(254,175,4,.16);border:1px solid rgba(254,175,4,.45);color:${GOLD};font-size:14px;font-weight:700;letter-spacing:.06em}
  h1{margin-top:26px;font-weight:700;font-size:46px;line-height:1.12;letter-spacing:-.025em}
  h1 .hl{color:${GOLD}}
  .sub{margin-top:12px;font-size:18.5px;line-height:1.45;color:#C9DBFF;max-width:560px}
  .feats{margin-top:auto;display:grid;grid-template-columns:1fr 1fr;gap:11px 14px}
  .f{display:flex;align-items:center;gap:11px;font-size:18px;font-weight:600;color:#EAF2FF;white-space:nowrap}
  .f i{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);color:${GOLD};flex:none}
  .f svg{width:18px;height:18px}
  .foot{margin-top:20px;display:flex;align-items:center;gap:12px;font-size:17px;font-weight:600;color:#9FC0F5}
  .foot b{color:#fff;font-weight:700}
  .foot .sep{width:5px;height:5px;border-radius:50%;background:${GOLD}}

  .stage{position:absolute;right:0;top:0;bottom:0;width:520px}
  .cv{position:absolute;left:160px;top:64px;width:290px;border-radius:12px;overflow:hidden;transform:rotate(4deg);
    box-shadow:0 40px 80px -20px rgba(2,8,40,.75), 0 0 0 1px rgba(255,255,255,.25)}
  .cv img{display:block;width:100%}
  .card{position:absolute;background:#fff;color:#0F172A;border-radius:16px;padding:14px 16px;direction:ltr;text-align:left;
    box-shadow:0 24px 50px -16px rgba(2,8,40,.6)}
  .card small{display:block;font-size:12.5px;font-weight:700;color:#64748B;letter-spacing:.03em;text-transform:uppercase}
  .score{left:22px;top:150px;display:flex;align-items:center;gap:12px}
  .ring{width:62px;height:62px;border-radius:50%;display:grid;place-items:center;flex:none;
    background:conic-gradient(${BRAND} 0 86%, #E2E8F0 86% 100%)}
  .ring span{width:48px;height:48px;border-radius:50%;background:#fff;display:grid;place-items:center;font-weight:700;font-size:19px;color:${NAVY}}
  .score b{display:block;font-size:16px;line-height:1.25}
  .ats{right:24px;top:300px;width:186px}
  .ats .row{display:flex;align-items:baseline;gap:6px;margin-top:2px}
  .ats .n{font-size:34px;font-weight:700;color:#059669;line-height:1}
  .ats .bar{margin-top:8px;height:8px;border-radius:5px;background:#E2E8F0;overflow:hidden}
  .ats .bar i{display:block;height:100%;width:94%;background:linear-gradient(90deg,#10B981,#059669)}
  .job{left:22px;bottom:44px;width:372px;display:flex;gap:12px;align-items:center}
  .job .logo{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,${GOLD},#FB923C);display:grid;place-items:center;color:#fff;font-weight:700;font-size:19px;flex:none}
  .job b{display:block;font-size:16px;line-height:1.25}
  .job .m{margin-left:auto;padding:5px 9px;border-radius:999px;background:#DCFCE7;color:#047857;font-size:13px;font-weight:700;white-space:nowrap}
  .live{right:22px;top:44px;display:flex;align-items:center;gap:9px;padding:10px 14px;background:#0F172A;color:#fff;font-size:14px;font-weight:700}
  .live i{width:9px;height:9px;border-radius:50%;background:#EF4444;box-shadow:0 0 0 4px rgba(239,68,68,.25)}
  `,
  body: `
  <div class="grid"></div>
  <div class="glow" style="width:${w * 0.34}px;height:${w * 0.34}px;background:${GOLD};top:${-h * 0.42}px;left:${-w * 0.1}px;opacity:.35"></div>
  <div class="left">
    <div class="lockup"><img src="${markSrc}" alt=""><div class="word">Interprova</div><span class="tag">AI CAREER PLATFORM</span></div>
    <h1>Practise interviews,<br>build your CV and<br><span class="hl">find your next job.</span></h1>
    <div class="sub">AI mock interviews with instant feedback, a live assistant for real calls, and jobs matched to your CV.</div>
    <div class="feats">
      <div class="f"><i>${ic('mic')}</i>AI mock interviews</div>
      <div class="f"><i>${ic('live')}</i>Live interview assistant</div>
      <div class="f"><i>${ic('cv')}</i>CV builder · 56 templates</div>
      <div class="f"><i>${ic('ats')}</i>ATS checker &amp; tailoring</div>
      <div class="f"><i>${ic('jobs')}</i>Global job search</div>
      <div class="f"><i>${ic('devices')}</i>Web · Android · Desktop</div>
    </div>
    <div class="foot"><b>interprova.com</b><span class="sep"></span>English &amp; Arabic</div>
  </div>
  <div class="stage">
    <div class="cv"><img src="${CV_THUMB}" alt=""></div>
    <div class="card live"><i></i>Live assistant on</div>
    <div class="card score"><div class="ring"><span>8.6</span></div><div><small>Interview score</small><b>Clear, structured<br>answers</b></div></div>
    <div class="card ats"><small>ATS score</small><div class="row"><span class="n">94</span><span style="color:#64748B;font-weight:700">/ 100</span></div><div class="bar"><i></i></div></div>
    <div class="card job"><div class="logo">N</div><div><b>Senior Software Engineer</b><small style="text-transform:none;letter-spacing:0">Dubai · Full-time</small></div><span class="m">91% match</span></div>
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
const OG_CARD = 'landing/og-image-v3.png';
/** Kept in step with OG_CARD, so links shared before each bump show the current card. */
const OG_ALIASES = ['landing/og-image.png', 'landing/og-image-v2.png'];

const shots = [
  { name: OG_CARD,                            w: 1200, h: 630,  html: OG_EN,  scale: 1 },
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
for (const alias of OG_ALIASES) {
  fs.copyFileSync(path.join(ROOT, OG_CARD), path.join(ROOT, alias));
  console.log(`  ${alias}  (alias of ${path.basename(OG_CARD)}, for links already shared)`);
}

console.log('done');
