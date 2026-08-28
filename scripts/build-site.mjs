/**
 * Assemble the marketing site from one layout and a folder of page bodies.
 *
 * The shared chrome — stylesheet, icon sprite, header, footer, behaviour script
 * — is EXTRACTED FROM index.html rather than kept in its own template file.
 * That is the whole point: the homepage is the page that gets edited, so any
 * copy of its chrome would drift from it within a week. Reading it back out
 * means the navigation, theme toggle and language switch on eight pages cannot
 * disagree with the homepage, because they are literally the same bytes.
 *
 *   node scripts/build-site.mjs
 *
 * Input:  landing/pages/<slug>.html   — body markup, with a JSON header comment
 * Output: landing/<slug>.html
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANDING = path.join(ROOT, 'landing');
const PAGES = path.join(LANDING, 'pages');
const ORIGIN = 'https://interprova.com';

const home = fs.readFileSync(path.join(LANDING, 'index.html'), 'utf8');

/** Pull one region out of the homepage, or die loudly. */
function region(name, re) {
  const m = home.match(re);
  if (!m) throw new Error(`build-site: could not find ${name} in index.html — the homepage changed shape`);
  return m[1] ?? m[0];
}

// The sheet is an external file now, so pages link it rather than inline it —
// ten copies of 55KB is ten cache misses and a slow site on a phone.
const STYLE_LINK = region('stylesheet link', /(<link rel="stylesheet" href="\/site\.css">)/);
const SPRITE  = region('sprite',   /(<svg width="0" height="0"[\s\S]*?<\/svg>)/);
const HEADER  = region('<header>', /(<header class="hdr"[\s\S]*?<\/header>)/);
const FOOTER  = region('<footer>', /(<footer class="ftr"[\s\S]*?<\/footer>)/);
const SCRIPTS = region('scripts',  /<\/footer>([\s\S]*?)<\/body>/);

/** Fonts and the rest of the <head> boilerplate, minus the page-specific tags. */
const FONT_LINKS = [...home.matchAll(/<link[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>/g)].map((m) => m[0]).join('\n');
const THEME_META = [...home.matchAll(/<meta id="tc-[^>]*>/g)].map((m) => m[0]).join('\n');

function layout({ slug, titleAr, titleEn, descAr, descEn, body }) {
  const url = slug === 'index' ? `${ORIGIN}/` : `${ORIGIN}/${slug}.html`;
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${titleAr} — Interprova</title>
<meta name="description" content="${descAr}">
<meta name="author" content="Interprova">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="ar" href="${url}">
<link rel="alternate" hreflang="en" href="${url}?lang=en">
<link rel="alternate" hreflang="x-default" href="${url}">
<link rel="manifest" href="/site.webmanifest">
<link rel="icon" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
${THEME_META}
<meta name="color-scheme" content="light dark">
<meta property="og:type" content="website">
<meta property="og:locale" content="ar_EG">
<meta property="og:site_name" content="Interprova">
<meta property="og:title" content="${titleAr} — Interprova">
<meta property="og:description" content="${descAr}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ORIGIN}/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${titleEn} — Interprova">
<meta name="twitter:description" content="${descEn}">
${FONT_LINKS}
${STYLE_LINK}
</head>
<body class="no-js">
${SPRITE}
${HEADER}
<main id="main">
${body}
</main>
${FOOTER}
${SCRIPTS}</body>
</html>
`;
}

if (!fs.existsSync(PAGES)) {
  console.error(`build-site: no ${path.relative(ROOT, PAGES)} directory — nothing to build`);
  process.exit(1);
}

const built = [];
for (const file of fs.readdirSync(PAGES).filter((f) => f.endsWith('.html')).sort()) {
  const slug = path.basename(file, '.html');
  const raw = fs.readFileSync(path.join(PAGES, file), 'utf8');

  // Front matter is a JSON object inside the first HTML comment, so the source
  // file stays valid HTML that an editor will still highlight and format.
  const fm = raw.match(/^<!--\s*(\{[\s\S]*?\})\s*-->\s*/);
  if (!fm) throw new Error(`build-site: ${file} has no JSON front-matter comment`);
  const meta = JSON.parse(fm[1]);
  const body = raw.slice(fm[0].length);

  const html = layout({ slug, body, ...meta });
  fs.writeFileSync(path.join(LANDING, `${slug}.html`), html, 'utf8');
  built.push(`${slug}.html  ${(html.length / 1024).toFixed(0)}KB`);
}

console.log(`site: ${built.length} pages from shared chrome`);
for (const b of built) console.log(`  ${b}`);
