/**
 * Content-address the landing site's assets, so a changed file is a changed URL.
 *
 * Why this exists
 *   Static assets are served with `max-age=1y` (backend/src/app.js). That is
 *   correct ONLY for filenames that change when their bytes change. The landing
 *   page shipped `shots/app-home.png` — a stable name — so every browser that
 *   ever loaded the page holds those bytes until 2027 and will not even send a
 *   conditional request. Re-deploying the file changes nothing the visitor sees;
 *   neither does a `?v=` query, because a year-long cache entry is matched
 *   before the query is considered by intermediaries that strip it, and because
 *   the entry is already stored under the versioned URL the moment it is used.
 *
 *   The only thing a browser cannot serve from cache is a URL it has never
 *   seen. So: hash the bytes, put the hash in the name, rewrite the references.
 *   A visitor gets the new image with no cache clearing, no data loss, and no
 *   "please hard-refresh" — which matters, because clearing site data also
 *   signs people out of their saved Google accounts.
 *
 * Why it runs on the STAGED copy, not the repo
 *   Hashed names in git would make every image edit a rename and every diff
 *   unreadable. `landing/` stays human-editable with plain names; the hashing
 *   happens between build and upload, the way a bundler would do it.
 *
 *   node scripts/fingerprint-assets.mjs <dir>
 *
 * Anything not rewritten keeps its plain name and still works — app.js only
 * grants the immortal cache header to names that carry a hash, so an asset this
 * script misses is merely re-validated, never stale.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/fingerprint-assets.mjs <landing-dir>');
  process.exit(2);
}

/**
 * Extensions worth hashing: big, cacheable, and referenced by name from markup.
 *
 * Deliberately NOT included: .ico and site.webmanifest, which browsers fetch
 * from fixed well-known paths of their own accord (`/favicon.ico`), and .html,
 * which is the entry point every hashed URL is discovered through and therefore
 * must keep its address.
 */
const HASHED = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.css', '.woff2', '.mp4']);

/**
 * Files whose URL is held by something we do not control, and which therefore
 * must never change.
 *
 *   favicon / apple-touch-icon / webmanifest — browsers fetch these from fixed
 *     well-known paths of their own accord.
 *
 *   og-image*.png — WhatsApp, Facebook, X and LinkedIn store the IMAGE URL when
 *     a link is first shared, and re-read it when the card is shown again. A
 *     hashed name would 404 on every link already in circulation, because a
 *     deploy replaces the whole directory and the old hash goes with it: every
 *     previously shared link would lose its preview the next time it rendered.
 *     Both the current card (`-v2`) and the unversioned alias are pinned; see
 *     render-text-assets.mjs for why there are two names for one picture.
 *
 *   logo-*.png — referenced from outbound EMAIL, which is permanent. A message
 *     sent last month must still render its logo today.
 *
 * They lose the immortal cache header in exchange (app.js grants that only to
 * hashed names) and get `no-cache` instead, so they revalidate — which is the
 * correct trade for an asset that changes rarely and is addressed forever.
 */
const PINNED = new Set([
  'favicon.ico', 'favicon.png', 'apple-touch-icon.png', 'site.webmanifest',
  'og-image.png', 'og-image-v2.png',
  'logo-mark.png', 'logo-mark-ondark.png', 'logo-horizontal.png',
]);

/** Where references live. Rewriting only these is why .html keeps its name. */
const REWRITE_IN = new Set(['.html', '.css', '.webmanifest', '.xml', '.txt']);

/** Every file under `root`, relative and posix-separated. */
function walk(root, base = root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(root, e.name);
    return e.isDirectory() ? walk(abs, base) : [path.relative(base, abs).split(path.sep).join('/')];
  });
}

const files = walk(dir);

/*
 * Pass 1 — rename.
 *
 * Longest-first ordering matters in pass 2, not here, but the map is built now
 * so that a stylesheet referencing an image gets the hashed image URL BEFORE the
 * stylesheet itself is hashed. Hence: hash images and fonts first, rewrite CSS,
 * then hash CSS. Doing it in one pass would bake a stale image URL into the
 * sheet and then immortalise it under a hash that says the bytes are final.
 */
const rename = new Map();       // 'shots/app-home.png' -> 'shots/app-home.7f3a91c2.png'

function fingerprint(rel) {
  const ext = path.extname(rel).toLowerCase();
  const abs = path.join(dir, rel);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex').slice(0, 8);
  const next = rel.slice(0, -ext.length) + '.' + hash + ext;
  fs.renameSync(abs, path.join(dir, next));
  rename.set(rel, next);
  return next;
}

/** Replace every reference to a renamed file, longest path first. */
function rewriteAll() {
  // Longest first: 'logo-mark-ondark.png' must be replaced before
  // 'logo-mark.png', or the shorter match corrupts the longer name.
  const pairs = [...rename.entries()].sort((a, b) => b[0].length - a[0].length);
  let touched = 0;
  for (const rel of walk(dir)) {
    if (!REWRITE_IN.has(path.extname(rel).toLowerCase())) continue;
    const abs = path.join(dir, rel);
    const before = fs.readFileSync(abs, 'utf8');
    let after = before;
    for (const [from, to] of pairs) {
      if (!after.includes(from)) continue;
      // Split/join rather than a RegExp: filenames contain '.' and would need
      // escaping, and a mis-escaped dot silently matches the wrong file.
      after = after.split(from).join(to);
    }
    if (after !== before) { fs.writeFileSync(abs, after); touched += 1; }
  }
  return touched;
}

const isHashable = (rel) => {
  const ext = path.extname(rel).toLowerCase();
  return HASHED.has(ext)
    && !PINNED.has(path.basename(rel))
    // Already carries a hash (an upstream bundler's, or a re-run of this script).
    && !/\.[0-9a-f]{8,}\.[a-z0-9]+$/i.test(rel);
};

// Media and fonts first — CSS may point at them.
const media = files.filter((f) => isHashable(f) && path.extname(f).toLowerCase() !== '.css');
media.forEach(fingerprint);
rewriteAll();

// Then stylesheets, whose bytes are only final once their image URLs are.
const sheets = walk(dir).filter((f) => isHashable(f) && path.extname(f).toLowerCase() === '.css');
sheets.forEach(fingerprint);
const pages = rewriteAll();

console.log(`  fingerprinted ${rename.size} assets, rewrote ${pages} files`);
for (const [from, to] of rename) console.log(`    ${from} → ${path.basename(to)}`);
