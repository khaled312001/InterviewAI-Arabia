/**
 * The web app must actually LOAD. Checked before it is allowed near a deploy.
 *
 * This exists because a build that succeeded, exported cleanly and reported
 * "Exported: dist" shipped a bundle the browser refused to parse. One
 * `import.meta` — from a transitive dependency, not from our code — is a
 * SyntaxError in a classic script, and Metro emits `<script src>` with no
 * `type="module"`. The engine never reached line 1, so /app/ was a white page
 * with a single console line, and nothing in the toolchain objected: Expo's
 * import.meta transform throws for Hermes but returns silently for web.
 *
 * So the lesson is encoded here in three widening circles:
 *
 *   1. PARSE   — every emitted .js compiled as a classic script. Catches the
 *                exact failure above in milliseconds, without a browser.
 *   2. BOOT    — served the way production serves it, loaded in a real engine,
 *                asserting the React tree actually mounted and that nothing
 *                threw on the way.
 *   3. MEDIA   — the capture APIs the interview depends on are reachable and
 *                not shut off by a permissions policy, with a real
 *                getUserMedia against a fake device to prove the grant path.
 *
 *   node scripts/probe-webapp.mjs [distDir | https://interprova.com]
 *
 * Given a URL it checks the DEPLOYED app instead of the local build — same
 * three circles, but reading the bundle the CDN is actually serving. Worth
 * doing separately: a correct dist and a correct deploy are two claims, and
 * the second one has its own ways to go wrong.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARG = process.argv[2] || path.join(ROOT, 'mobile', 'dist');
const REMOTE = /^https?:\/\//i.test(ARG);
const DIST = REMOTE ? null : path.resolve(ARG);
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const failures = [];
const fail = (msg) => { failures.push(msg); console.log(`  [FAIL] ${msg}`); };
const pass = (msg) => console.log(`  [ ok ] ${msg}`);
const note = (msg) => console.log(`   ..   ${msg}`);

if (!REMOTE && !fs.existsSync(DIST)) {
  console.error(`probe-webapp: no ${path.relative(ROOT, DIST)} — run \`npm run build:web\` first`);
  process.exit(1);
}

console.log(`\nprobing ${REMOTE ? ARG.replace(/\/$/, '') + '/app/' : path.relative(ROOT, DIST)}`);

/* ───────────────────────── 1. parse ───────────────────────── */

console.log('\n1. bundle parses as a classic script');

/** Every emitted script, as {label, source} — from disk or over the wire. */
async function collectScripts() {
  if (!REMOTE) {
    const out = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.js')) out.push(p);
      }
    })(DIST);
    return {
      html: fs.readFileSync(path.join(DIST, 'index.html'), 'utf8'),
      scripts: out.map((f) => ({
        label: path.relative(DIST, f).replace(/\\/g, '/'),
        source: fs.readFileSync(f, 'utf8'),
      })),
    };
  }

  const origin = ARG.replace(/\/$/, '');
  const doc = await fetch(`${origin}/app/`).then((r) => r.text());
  // Only what the page actually loads — the served tree may hold older hashed
  // chunks that no longer matter, and they should not fail a deploy.
  const srcs = [...doc.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/gi)].map((m) => m[1]);
  const scripts = [];
  for (const s of srcs) {
    const url = new URL(s, `${origin}/app/`).href;
    const r = await fetch(url);
    if (!r.ok) { fail(`${url} → HTTP ${r.status}`); continue; }
    scripts.push({ label: url.replace(origin, ''), source: await r.text() });
  }
  return { html: doc, scripts };
}

const { html, scripts } = await collectScripts();

if (!scripts.length) fail('the page loads no scripts at all');

for (const { label, source } of scripts) {
  try {
    // `vm.Script` is the same parser the browser uses for a non-module
    // <script>. `import.meta`, top-level `await` and bare `import`/`export`
    // all throw here exactly as they would there.
    new vm.Script(source, { filename: label });
    pass(`${label} (${(source.length / 1048576).toFixed(2)} MB)`);
  } catch (err) {
    fail(`${label} — ${err.message}`);
  }
}

// The HTML must agree with how the bundle was compiled. If a future Expo emits
// `type="module"` this probe should be told, not silently keep asserting the
// classic-script contract.
const moduleScript = /<script[^>]*type=["']module["']/.test(html);
note(`entry <script> is a ${moduleScript ? 'MODULE' : 'classic script'}`);

/* ───────────────────────── 2. boot ───────────────────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
};

/**
 * Production mounts the SPA at /app but Metro emits absolute /_expo and
 * /assets URLs, so those resolve from the bundle root regardless of the
 * prefix. Mirrored here — a probe that served the folder flat at / would pass
 * while production 404s every chunk.
 */
const server = REMOTE ? null : http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel.startsWith('/app')) rel = rel.slice(4) || '/';
  const file = path.join(DIST, rel);
  if (rel !== '/' && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
    return;
  }
  if (rel.startsWith('/api/')) {           // the app will call these; not our subject
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end('{"error":"probe stub"}');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME['.html'] });
  res.end(html);
});
if (server) await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = REMOTE ? ARG.replace(/\/$/, '') : `http://127.0.0.1:${server.address().port}`;

console.log('\n2. app boots in a real engine');

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--lang=ar-EG',
    // Grant capture without a prompt and synthesise a device, so the probe
    // exercises the real getUserMedia path rather than mocking it away.
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--auto-select-desktop-capture-source=Entire screen',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 900 });

const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  // Our own stubbed API is expected to fail; that is not what is under test.
  if (/probe stub|Failed to load resource|net::ERR|503/i.test(t)) return;
  consoleErrors.push(t);
});

await page.goto(`${BASE}/app/`, { waitUntil: 'networkidle2', timeout: 60000 });

// The single most valuable assertion: React actually rendered something.
let mounted = false;
try {
  await page.waitForFunction(
    () => { const r = document.getElementById('root'); return !!r && r.childElementCount > 0; },
    { timeout: 20000 },
  );
  mounted = true;
} catch { /* reported below */ }

if (pageErrors.length) for (const e of pageErrors) fail(`uncaught: ${e}`);
else pass('no uncaught exceptions');

if (consoleErrors.length) for (const e of consoleErrors) fail(`console.error: ${e.slice(0, 200)}`);
else pass('no console errors');

if (mounted) {
  const text = (await page.evaluate(() => document.body.innerText || '')).trim();
  pass(`#root mounted, ${text.length} chars of visible text`);
  note(`first line: ${text.split('\n').filter(Boolean)[0]?.slice(0, 80) || '(none)'}`);
} else {
  fail('#root never received a child — the app did not mount');
}

/* ───────────────────────── 3. media ───────────────────────── */

console.log('\n3. camera / microphone / screen capture are reachable');

const media = await page.evaluate(async () => {
  const out = {
    secureContext: window.isSecureContext,
    getUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
    getDisplayMedia: typeof navigator.mediaDevices?.getDisplayMedia === 'function',
    mediaRecorder: typeof window.MediaRecorder === 'function',
    speech: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    synthesis: typeof window.speechSynthesis?.speak === 'function',
    policy: {},
    camGrant: null,
    tracks: [],
    webm: null,
  };

  // A Permissions-Policy header would disable these silently — the call just
  // rejects with NotAllowedError and looks like the user said no.
  const pp = document.featurePolicy || document.permissionsPolicy;
  for (const f of ['camera', 'microphone', 'display-capture']) {
    try { out.policy[f] = pp ? pp.allowsFeature(f) : 'unknown'; } catch { out.policy[f] = 'unknown'; }
  }

  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    out.camGrant = 'granted';
    out.tracks = s.getTracks().map((t) => `${t.kind}:${t.readyState}`);
    if (out.mediaRecorder) {
      out.webm = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        .find((m) => MediaRecorder.isTypeSupported(m)) || null;
    }
    s.getTracks().forEach((t) => t.stop());
  } catch (e) {
    out.camGrant = `${e.name}: ${e.message}`;
  }
  return out;
});

if (media.secureContext) pass('secure context');
else fail('not a secure context — capture APIs are disabled');
if (media.getUserMedia) pass('navigator.mediaDevices.getUserMedia present');
else fail('getUserMedia missing');
if (media.getDisplayMedia) pass('getDisplayMedia (screen recording) present');
else fail('getDisplayMedia missing');
if (media.mediaRecorder) pass('MediaRecorder present');
else fail('MediaRecorder missing');

for (const [f, v] of Object.entries(media.policy)) {
  if (v === false) fail(`permissions policy BLOCKS "${f}" — a response header is shutting capture off`);
  else pass(`permissions policy allows "${f}"${v === 'unknown' ? ' (no policy object; unrestricted)' : ''}`);
}

if (media.camGrant === 'granted') pass(`getUserMedia returned [${media.tracks.join(', ')}]`);
else fail(`getUserMedia failed — ${media.camGrant}`);

if (media.webm) pass(`recording container: ${media.webm}`);
else fail('no supported WebM recording profile');
if (media.speech) pass('SpeechRecognition present');
else note('SpeechRecognition absent (Firefox/Safari — server STT covers it)');
if (media.synthesis) pass('speechSynthesis present');
else note('speechSynthesis absent (server TTS covers it)');

await browser.close();
if (server) server.close();

console.log(failures.length ? `\n${failures.length} FAILED\n` : '\nweb app is loadable and capture-capable\n');
process.exit(failures.length ? 1 : 0);
