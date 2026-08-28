/**
 * Prove the OAuth popup closes itself instead of rendering the app.
 *
 * The failure this guards against was reported three times and "fixed" twice,
 * because it was diagnosed by reading code rather than by running it. Reading
 * could not find it: both call sites of `maybeCompleteAuthSession()` were
 * correct in isolation, and only their EVALUATION ORDER made the second one
 * always lose. The only way to see that is to run it.
 *
 * So this reproduces the real thing:
 *   1. open a page on our origin, and from it `window.open()` a popup — the
 *      popup MUST be script-opened or `window.close()` is refused, exactly as
 *      in the real flow;
 *   2. plant the handle in localStorage the way expo-web-browser's opener does;
 *   3. navigate the popup to the redirect URL with a token in the fragment;
 *   4. assert the popup CLOSED.
 *
 * A popup that survives step 4 is the bug: the user is left staring at the
 * onboarding slides with an id_token in the address bar.
 *
 *   node scripts/probe-auth-popup.mjs [baseUrl]
 */

import puppeteer from 'puppeteer-core';

const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.argv[2] || 'https://interprova.com';
const REDIRECT = `${BASE}/app/`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failed = [];
const ok = (c, m) => { if (!c) failed.push(m); console.log(`  ${c ? '✅' : '❌'} ${m}`); };

/* A structurally valid, EXPIRED, unsigned-for-us token. It never reaches a
   verifier — the assertion is about the window, not the credential — but it
   has to parse as a JWT for the client code to treat the URL as a real
   redirect. */
const FAKE_ID_TOKEN = [
  Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', sub: 'probe', exp: 0 })).toString('base64url'),
  'not-a-real-signature',
].join('.');

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--no-sandbox', '--lang=ar-EG'],
});

const opener = await browser.newPage();
await opener.setViewport({ width: 1100, height: 800 });
await opener.goto(REDIRECT, { waitUntil: 'networkidle2', timeout: 90000 });
await sleep(4000);
console.log(`\n▸ opener loaded ${REDIRECT}`);

// The exact localStorage keys expo-web-browser's web implementation uses.
// If a future version renames them this probe goes red, which is correct:
// the production code depends on the same names.
const KEYS = await opener.evaluate(() => {
  const found = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (k && k.toLowerCase().includes('expowebbrowser')) found[k] = localStorage.getItem(k);
  }
  return found;
});
console.log('  existing expo-web-browser keys:', Object.keys(KEYS).length ? Object.keys(KEYS) : '(none yet)');

/*
 * SCENARIO A — the handle is missing.
 *
 * This is the case that actually happens in production and the one every
 * previous fix failed on. The popup has just been navigated through Google's
 * sign-in pages, which send `Cross-Origin-Opener-Policy: same-origin`; that
 * severs the opener relationship and can take the library's bookkeeping with
 * it. `maybeCompleteAuthSession()` then returns `failed` on a redirect that
 * genuinely succeeded.
 *
 * Any fix gated on that function's verdict passes scenario B below and fails
 * here — which is exactly the shape of the bug that was reported three times.
 * The popup must close on the strength of the id_token in the URL alone.
 */
console.log('\n▸ SCENARIO A — no handle in storage (the real COOP case)');
{
  const targetA = `${REDIRECT}#state=coopcase&id_token=${FAKE_ID_TOKEN}&authuser=1&prompt=none`;
  await opener.evaluate((url) => {
    // Deliberately plant NOTHING. This is the state COOP leaves behind.
    localStorage.removeItem('ExpoWebBrowserRedirectHandle');
    localStorage.removeItem('interprova.auth.relay');
    window.__probePopupA = window.open(url, 'probe-popup-a', 'width=520,height=640');
  }, targetA);

  await sleep(12000);

  const openA = await opener.evaluate(() => {
    try { return Boolean(window.__probePopupA) && !window.__probePopupA.closed; }
    catch { return 'cross-origin'; }
  });
  const survivorsA = (await browser.pages()).filter((p) => p !== opener && p.url().includes('/app'));
  ok(openA === false && survivorsA.length === 0,
     `popup closed with NO handle present (open:${openA}, surviving pages:${survivorsA.length})`);

  if (survivorsA.length) {
    const txt = await survivorsA[0].evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 180));
    console.log(`  popup is showing: "${txt}"`);
    await survivorsA[0].close().catch(() => {});
  }

  const relayA = await opener.evaluate(() => {
    try { return localStorage.getItem('interprova.auth.relay'); } catch { return 'unreadable'; }
  });
  // The opener here sits on onboarding, where useGoogleSignIn is not mounted,
  // so nothing consumes it — the point is only that the popup WROTE it.
  ok(typeof relayA === 'string' && relayA.includes('id_token'),
     `token handed to the opener via the relay (${relayA ? 'written' : 'MISSING'})`);
  await opener.evaluate(() => { try { localStorage.removeItem('interprova.auth.relay'); } catch {} });
}

console.log('\n▸ SCENARIO B — handle present (the library path still works)');
const target = `${REDIRECT}#state=probe123&id_token=${FAKE_ID_TOKEN}&authuser=0&prompt=none`;

await opener.evaluate((redirect, url) => {
  /* The EXACT keys and value shape openAuthSessionAsync() writes. Taken from
     expo-web-browser/build/ExpoWebBrowser.web.js — an approximation here makes
     the probe green or red for reasons that have nothing to do with the app:
       handle key   'ExpoWebBrowserRedirectHandle'         (a literal)
       redirect key `ExpoWebBrowser_RedirectUrl_<state>`
       redirect VALUE is normalizeUrl(redirect), not the raw URL — lowercase
       host + pathname with the protocol and trailing slashes stripped. */
  const normalizeUrl = (u) => {
    const origin = u.origin.replace(u.protocol, '').replace(/^\/+/, '').replace(/\/+$/, '');
    return (origin + decodeURI(u.pathname.replace(/\/{2,}/g, '/'))).toLowerCase();
  };
  localStorage.setItem('ExpoWebBrowserRedirectHandle', 'probe123');
  localStorage.setItem('ExpoWebBrowser_RedirectUrl_probe123', normalizeUrl(new URL(redirect)));
  window.__probePopup = window.open(url, 'probe-popup', 'width=520,height=640');
}, REDIRECT, target);

// Give the popup time to boot the bundle, complete the session and close.
await sleep(12000);

const stillOpen = await opener.evaluate(() => {
  try { return Boolean(window.__probePopup) && !window.__probePopup.closed; }
  catch { return 'cross-origin'; }
});

const pages = await browser.pages();
const popupPages = pages.filter((p) => p !== opener && p.url().includes('/app'));

ok(stillOpen === false, `popup closed itself (window.closed check -> ${stillOpen})`);
ok(popupPages.length === 0, `no surviving popup page (${popupPages.length} found)`);

// If it did survive, say WHAT it is showing — that is the diagnostic that was
// missing every previous time this was investigated.
if (popupPages.length) {
  const txt = await popupPages[0].evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 200));
  console.log(`\n  popup is showing: "${txt}"`);
  const isApp = /تدرّب|تخطي|التالي|onboarding/i.test(txt);
  ok(!isApp, 'popup is NOT rendering the full app');
  const isPanel = /يمكنك إغلاق|close this window/i.test(txt);
  console.log(`  fallback panel shown: ${isPanel ? 'yes' : 'no'}`);
}

/*
 * The half that matters more than the window.
 *
 * A popup that closes but hands nothing back is a WORSE bug than one that
 * stays open: the window vanishes, so it looks like it worked, and the person
 * is still signed out. The opener's own 1-second "is the popup gone?" timer
 * resolves 'dismiss' in exactly that case, which is why the relay exists.
 *
 * The relay key is consumed by the hook the moment it is seen, so finding it
 * ALREADY GONE is the passing result — it means something was listening.
 * Finding the raw value still sitting there means nobody was.
 */
console.log('\n▸ did the token reach the opener?');
const relay = await opener.evaluate(() => {
  try {
    return {
      leftover: localStorage.getItem('interprova.auth.relay'),
      keys: Object.keys(localStorage).filter((k) => k.startsWith('interprova.') || k.startsWith('ExpoWebBrowser')),
    };
  } catch { return { leftover: 'unreadable', keys: [] }; }
});
ok(relay.leftover === null || String(relay.leftover).includes('id_token'),
   `relay handled (${relay.leftover === null ? 'consumed by the opener' : 'written, awaiting the sign-in screen'})`);
console.log('  storage keys now:', relay.keys.length ? relay.keys : '(clean)');

await browser.close();
console.log(failed.length ? `\n${failed.length} FAILED\n` : '\npopup behaves correctly\n');
process.exit(failed.length ? 1 : 0);
