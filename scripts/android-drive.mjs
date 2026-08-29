#!/usr/bin/env node
/**
 * Drive the installed Android app from the desktop, by TEXT rather than by
 * pixel coordinates.
 *
 * Why this exists
 *   Testing a native flow by hand meant: screenshot, read it, work out where
 *   the button is, `adb shell input tap x y`, screenshot again. Every step is
 *   a round trip, every coordinate is guessed from a scaled image, and the
 *   whole script rots the moment a font or an inset changes. Worse, a tap that
 *   lands while another app is in the foreground goes into THAT app — which is
 *   how a test run ends up typing into somebody's chat.
 *
 *   `uiautomator dump` gives the real view hierarchy with real bounds, and
 *   React Native puts its visible strings in the `text` attribute. So a step
 *   can say what it MEANS — tap the button that reads «تسجيل» — and refuse
 *   rather than guess when that button is not on screen.
 *
 * Usage
 *   node scripts/android-drive.mjs ui                      # dump what is on screen
 *   node scripts/android-drive.mjs tap  "<text>"           # tap the node with this text
 *   node scripts/android-drive.mjs wait "<text>" [ms]      # block until it appears
 *   node scripts/android-drive.mjs shot <name>             # screenshot into the run dir
 *   node scripts/android-drive.mjs record-test             # the whole recording flow
 *
 * Matching is on a normalised substring, so «ابدأ المقابلة» finds
 * «ابدأ المقابلة المحاكاة» and Arabic diacritics or tatweel do not break it.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ADB = process.env.ADB || 'adb';
const PKG = process.env.APP_PKG || 'com.interprova.app';
const OUT = process.env.DRIVE_OUT || join(process.cwd(), '.drive');

/* ------------------------------------------------------------------ adb */

function adb(args, opts = {}) {
  return execFileSync(ADB, args, {
    encoding: opts.binary ? 'buffer' : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Refuse to drive anything but our own app: a stray tap belongs to nobody. */
function foregroundPackage() {
  const dump = adb(['shell', 'dumpsys', 'activity', 'activities']);
  const m = /topResumedActivity=ActivityRecord\{\S+ \S+ ([^/]+)\//.exec(dump);
  return m ? m[1] : null;
}

function assertOurAppIsForeground() {
  const pkg = foregroundPackage();
  if (pkg !== PKG) {
    throw new Error(
      `${PKG} is not in the foreground (${pkg ?? 'unknown'} is). Refusing to send input —\n` +
      `a tap now would land in that app. Bring the app forward and retry.`,
    );
  }
}

/* ----------------------------------------------------------- hierarchy */

/**
 * The view tree as a flat list of {text, desc, cls, cx, cy, clickable}.
 *
 * uiautomator writes to a file on the device rather than to stdout, and it
 * fails with "could not get idle state" while an animation is running — so
 * this retries rather than treating a busy screen as an empty one.
 */
function dumpUi(attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    try {
      adb(['shell', 'uiautomator', 'dump', '/sdcard/window_dump.xml'], { stdio: 'pipe' });
      const xml = adb(['shell', 'cat', '/sdcard/window_dump.xml']);
      if (xml.includes('<hierarchy')) return parseNodes(xml);
    } catch {
      /* animating, or the window is not stable yet */
    }
    execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},400)']);
  }
  throw new Error('uiautomator never produced a stable dump');
}

function parseNodes(xml) {
  const nodes = [];
  const re = /<node\b([^>]*)\/?>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1];
    const get = (name) => {
      const a = new RegExp(`${name}="([^"]*)"`).exec(attrs);
      return a ? decodeXml(a[1]) : '';
    };
    const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(attrs);
    if (!bounds) continue;
    const [, x1, y1, x2, y2] = bounds.map(Number);
    nodes.push({
      text: get('text'),
      desc: get('content-desc'),
      cls: get('class'),
      clickable: get('clickable') === 'true',
      enabled: get('enabled') === 'true',
      x1, y1, x2, y2,
      cx: Math.round((x1 + x2) / 2),
      cy: Math.round((y1 + y2) / 2),
    });
  }
  return nodes;
}

function decodeXml(s) {
  return s
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/**
 * Arabic comes off the screen with tatweel, diacritics and presentation forms
 * that are invisible to a reader and fatal to `includes()`. Strip them from
 * both sides of the comparison.
 */
function normalise(s) {
  return (s || '')
    .normalize('NFKD')
    .replace(/[ـً-ٰٟۖ-ۭ]/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function findNode(nodes, needle) {
  const want = normalise(needle);
  const hits = nodes.filter((n) => normalise(n.text).includes(want) || normalise(n.desc).includes(want));
  if (!hits.length) return null;
  // A tappable node beats a label that merely contains the same words — in RN
  // the caption and its touchable are separate nodes and only one responds.
  return hits.find((n) => n.clickable) || hits[0];
}

/* -------------------------------------------------------------- actions */

async function waitFor(needle, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    last = dumpUi();
    const hit = findNode(last, needle);
    if (hit) return hit;
    await sleep(700);
  }
  const visible = last.filter((n) => n.text).map((n) => n.text).slice(0, 40);
  throw new Error(`timed out waiting for «${needle}».\nOn screen: ${JSON.stringify(visible, null, 1)}`);
}

async function tap(needle, timeoutMs = 20000) {
  assertOurAppIsForeground();
  const node = await waitFor(needle, timeoutMs);
  if (!node.enabled) throw new Error(`«${needle}» is present but disabled`);
  adb(['shell', 'input', 'tap', String(node.cx), String(node.cy)]);
  return node;
}

/** Taps a SYSTEM dialog — the capture-consent sheet is not our package. */
async function tapSystem(needle, timeoutMs = 20000) {
  const node = await waitFor(needle, timeoutMs);
  adb(['shell', 'input', 'tap', String(node.cx), String(node.cy)]);
  return node;
}

async function scrollUp(times = 1) {
  for (let i = 0; i < times; i++) {
    adb(['shell', 'input', 'swipe', '636', '2200', '636', '900', '300']);
    await sleep(900);
  }
}

function shot(name) {
  mkdirSync(OUT, { recursive: true });
  const png = adb(['exec-out', 'screencap', '-p'], { binary: true });
  const path = join(OUT, `${name}.png`);
  writeFileSync(path, png);
  return path;
}

/**
 * Get through Android's screen-capture sheet.
 *
 * It is not one dialog and not one layout. Depending on the OS version there
 * is a scope dropdown whose "entire screen" option only becomes a tappable
 * node once the dropdown is OPEN, a confirm button labelled Next or Start now
 * or the local-language equivalent, and — if the scope stayed on "one app" —
 * an app chooser after it. A fixed sequence of taps gets this wrong, and gets
 * it wrong by pressing Cancel: the first run of this script declined its own
 * consent and then re-opened the dialog while trying to stop.
 *
 * So each pass looks at what is actually on screen and takes the one step that
 * follows from it, until the sheet is gone.
 */
async function acceptCaptureConsent(rounds = 8) {
  // Every label Android has used for "yes" on this sheet. `Share screen` is
  // the one this device shows once the scope is the whole display; it is NOT a
  // substring of the title ("Share your screen with …"), so it is safe here.
  const CONFIRM = [
    'Share screen', 'Start now', 'Start recording', 'Record screen', 'Start', 'Next', 'Allow',
    'مشاركة الشاشة', 'ابدا الان', 'ابدأ', 'التالي', 'سماح',
  ];
  for (let i = 0; i < rounds; i++) {
    await sleep(1200);
    const nodes = dumpUi();

    const onSheet = nodes.some((n) => /Share (your screen|one app|entire screen)/i.test(n.text || n.desc || ''));
    const chooser = findNode(nodes, 'Interprova');
    if (!onSheet && !chooser) return;      // sheet gone: accepted, or dismissed

    /*
     * Whether the scope list is OPEN is the thing to read, and the only honest
     * signal is how many of its options are on screen. Once "entire screen" is
     * chosen the collapsed spinner READS "Share entire screen" — so matching
     * that string alone reopens the list forever, which is exactly what the
     * first version of this did, seven times in a row.
     */
    const entire = findNode(nodes, 'Share entire screen');
    const oneApp = findNode(nodes, 'Share one app');
    const listOpen = Boolean(entire && oneApp);

    if (listOpen) {
      console.log('  · scope: entire screen');
      adb(['shell', 'input', 'tap', String(entire.cx), String(entire.cy)]);
      continue;
    }
    if (oneApp && !entire) {
      console.log('  · opening the scope list');
      adb(['shell', 'input', 'tap', String(oneApp.cx), String(oneApp.cy)]);
      continue;
    }
    const confirm = CONFIRM.map((l) => findNode(nodes, l)).find(Boolean);
    if (confirm) {
      console.log('  · confirming ("' + (confirm.text || confirm.desc) + '")');
      adb(['shell', 'input', 'tap', String(confirm.cx), String(confirm.cy)]);
      continue;
    }
    /*
     * The app picker, and ONLY the app picker. The consent sheet's own title
     * is "Share your screen with Interprova?", so matching the app name while
     * that sheet is up taps the heading over and over — which is how this
     * loop previously spent all eight rounds "choosing this app".
     */
    if (chooser && !onSheet) {
      console.log('  · choosing this app in the picker');
      adb(['shell', 'input', 'tap', String(chooser.cx), String(chooser.cy)]);
      continue;
    }
    // On the sheet with nothing recognisable to press: say so rather than
    // flail, because the next blind tap is the one that hits Cancel.
    throw new Error(
      'stuck on the capture sheet. On screen: ' +
      JSON.stringify(nodes.filter((n) => n.text).map((n) => n.text).slice(0, 25)),
    );
  }
}

/* ------------------------------------------------------- recording test */

/**
 * The flow the screen recorder has to survive, start to finish, with the
 * native log captured across the whole of it.
 */
async function recordTest() {
  mkdirSync(OUT, { recursive: true });
  const logPath = join(OUT, 'recorder.log');

  adb(['logcat', '-c']);
  const log = spawn(ADB, ['logcat', '-v', 'time'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const chunks = [];
  log.stdout.on('data', (d) => chunks.push(d));
  const stopLog = () => {
    log.kill();
    writeFileSync(logPath, Buffer.concat(chunks));
  };

  try {
    console.log('· launching');
    adb(['shell', 'am', 'force-stop', PKG]);
    adb(['shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1'], { stdio: 'pipe' });
    await sleep(9000);

    // The intro slides only appear when signed out; skipping is harmless when
    // they are absent, so this step is allowed to miss.
    try { await tap('تخطي', 4000); await sleep(2500); } catch { /* already signed in */ }

    /*
     * Where a relaunch actually lands is not fixed. React Navigation restores
     * the previous screen, so a force-stop can come back on the setup form or
     * even inside a meeting rather than on the home tab. Branch on what is
     * really there instead of assuming, and walk back only as far as needed.
     */
    for (let i = 0; i < 6; i++) {
      // BACK from the app's own home leaves the app entirely, and the next
      // step would then be driving the launcher. Come back rather than fail.
      if (foregroundPackage() !== PKG) {
        console.log('· app left the foreground; relaunching');
        adb(['shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1'], { stdio: 'pipe' });
        await sleep(6000);
      }
      const nodes = dumpUi();
      if (findNode(nodes, 'ابدأ مقابلة مباشرة')) { console.log('· at home'); break; }
      if (findNode(nodes, 'ابدأ المقابلة المحاكاة')) { console.log('· already on the setup form'); break; }
      if (findNode(nodes, 'إنهاء')) { console.log('· already in a meeting'); break; }
      adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
      await sleep(2000);
    }

    // `إنهاء` (end call) exists only on the meeting screen; `تسجيل` is too
    // common a substring to identify it on its own.
    const inMeeting = () => Boolean(findNode(dumpUi(), 'إنهاء'));

    if (!inMeeting()) {
      if (!findNode(dumpUi(), 'ابدأ المقابلة المحاكاة')) {
        console.log('· opening the interview setup');
        await tap('ابدأ مقابلة مباشرة');
        await sleep(3000);
        console.log('· choosing a field');
        await scrollUp(1);
        try { await tap('برمجة', 6000); } catch { console.log('  (field already chosen)'); }
        await sleep(800);
        await scrollUp(2);
      }

      console.log('· starting the meeting');
      await tap('ابدأ المقابلة المحاكاة');
      await sleep(9000);
    }
    shot('meeting');

    console.log('· pressing record');
    await tap('تسجيل');
    await sleep(2500);

    console.log('· accepting the capture consent');
    await acceptCaptureConsent();

    // `إيقاف` replaces `تسجيل` on the control the moment the recorder is
    // actually running, so it is the app's own answer to "did it start?" —
    // better than a fixed sleep, and the difference between a real pass and a
    // test that only looked like one.
    let started = false;
    for (let i = 0; i < 12; i++) {
      if (findNode(dumpUi(), 'إيقاف')) { started = true; break; }
      await sleep(1000);
    }
    shot('recording');
    if (!started) throw new Error('the recorder never started — the control still reads «تسجيل»');
    console.log('· recording (the control now reads «إيقاف»)');

    await sleep(15000);

    console.log('· stopping');
    await tap('إيقاف');
    await sleep(8000);
    shot('stopped');
  } finally {
    stopLog();
  }

  console.log('\n=== ScreenRecorder log ===');
  const text = Buffer.concat(chunks).toString('utf8');
  const lines = text.split('\n').filter((l) => /ScreenRecorder|MediaProjection|ForegroundService|AndroidRuntime|FATAL/.test(l));
  console.log(lines.slice(-60).join('\n') || '(nothing matched)');

  /*
   * A release build is not debuggable, so `run-as` is refused and the app's
   * private directories cannot be listed from the shell. The app's own answer
   * is better evidence anyway: on a good take it moves the file out of the
   * cache, offers it through the share sheet, and says so on screen.
   */
  console.log('\n=== what the app says about the file ===');
  const after = dumpUi();
  for (const marker of ['تم حفظ التسجيل', 'لم يسجل', 'تعذر بدء التسجيل', 'Share', 'مشاركة']) {
    const hit = findNode(after, marker);
    if (hit) console.log('  · "' + (hit.text || hit.desc) + '"');
  }
  console.log(`\nlog: ${logPath}\nshots: ${OUT}`);
}

/* ----------------------------------------------------------------- main */

const [cmd, ...rest] = process.argv.slice(2);

try {
  if (cmd === 'ui') {
    const nodes = dumpUi().filter((n) => n.text || n.desc);
    for (const n of nodes) {
      console.log(`${n.clickable ? '[tap]' : '     '} ${(n.text || n.desc).slice(0, 60)}  @${n.cx},${n.cy}`);
    }
  } else if (cmd === 'tap') {
    const n = await tap(rest[0]);
    console.log(`tapped «${n.text || n.desc}» @${n.cx},${n.cy}`);
  } else if (cmd === 'wait') {
    const n = await waitFor(rest[0], Number(rest[1] || 20000));
    console.log(`found «${n.text || n.desc}» @${n.cx},${n.cy}`);
  } else if (cmd === 'shot') {
    console.log(shot(rest[0] || 'shot'));
  } else if (cmd === 'record-test') {
    await recordTest();
  } else {
    console.log('commands: ui | tap <text> | wait <text> [ms] | shot <name> | record-test');
    process.exit(2);
  }
} catch (e) {
  console.error(`\n${e.message}`);
  process.exit(1);
}
