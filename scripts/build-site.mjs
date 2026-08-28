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

/**
 * The share card, versioned.
 *
 * Social scrapers key their cache on the image URL and hold it indefinitely,
 * so the only way to replace a card they have already stored is to hand them a
 * different address. `og-image.png` still exists and holds the same bytes, for
 * links shared before the bump. See scripts/render-text-assets.mjs.
 */
const OG_IMAGE = `${ORIGIN}/og-image-v2.png`;

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
// The mobile drawer is a SIBLING of the header, not a child: `.hdr` carries a
// backdrop-filter, which makes it the containing block for anything fixed
// inside it, and a drawer nested there is clipped to the header's own 68px box.
// So it is lifted as its own region and re-emitted next to the header.
const DRAWER  = region('nav drawer', /(<div class="nav-scrim"[\s\S]*?<\/aside>)/);
const FOOTER  = region('<footer>', /(<footer class="ftr"[\s\S]*?<\/footer>)/);
const SCRIPTS = region('scripts',  /<\/footer>([\s\S]*?)<\/body>/);

/** Fonts and the rest of the <head> boilerplate, minus the page-specific tags. */
const FONT_LINKS = [...home.matchAll(/<link[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>/g)].map((m) => m[0]).join('\n');
const THEME_META = [...home.matchAll(/<meta id="tc-[^>]*>/g)].map((m) => m[0]).join('\n');

/**
 * Per-page structured data.
 *
 * The homepage carries Organization / WebSite / SoftwareApplication / HowTo by
 * hand. The generated pages had none, so Google saw eleven pages of unlabelled
 * prose — and the three blog posts in particular are exactly the content that
 * benefits from being declared an Article with a headline and a publisher.
 *
 * A BreadcrumbList goes on every generated page. It is what produces the
 * "interprova.com › Blog › …" trail in a result instead of a bare URL, and it
 * costs nothing because the hierarchy is already implied by the slug.
 */
function structuredData({ slug, titleAr, descAr, url }) {
  const isPost = slug.startsWith('blog-');
  const crumbs = [
    { '@type': 'ListItem', position: 1, name: 'Interprova', item: `${ORIGIN}/` },
  ];
  if (isPost) crumbs.push({ '@type': 'ListItem', position: 2, name: 'المدوّنة', item: `${ORIGIN}/blog.html` });
  crumbs.push({ '@type': 'ListItem', position: crumbs.length + 1, name: titleAr, item: url });

  const graph = [{ '@type': 'BreadcrumbList', itemListElement: crumbs }];

  if (isPost) {
    graph.push({
      '@type': 'Article',
      headline: titleAr,
      description: descAr,
      inLanguage: 'ar',
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      image: OG_IMAGE,
      author: { '@type': 'Organization', name: 'Interprova', url: `${ORIGIN}/` },
      publisher: { '@id': `${ORIGIN}/#org` },
    });
  }

  if (slug === 'contact') {
    graph.push({
      '@type': 'ContactPage',
      name: titleAr,
      url,
      mainEntity: {
        '@type': 'Organization',
        '@id': `${ORIGIN}/#org`,
        email: 'info@interprova.com',
      },
    });
  }

  return `<script type="application/ld+json">
${
    JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2)
  }
</script>`;
}

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
<meta property="og:image" content="${OG_IMAGE}">
<meta property="og:image:secure_url" content="${OG_IMAGE}">
<meta property="og:image:type" content="image/png">
<!-- Dimensions let WhatsApp and Facebook lay the card out from the markup
     alone; without them the preview reflows once the image finally lands, and
     some clients skip the image entirely rather than wait for it. -->
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Interprova — تدرّب على مقابلة العمل بالعربية قبل أن تدخلها فعلاً">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${titleEn} — Interprova">
<meta name="twitter:description" content="${descEn}">
<meta name="twitter:image" content="${OG_IMAGE}">
${FONT_LINKS}
${STYLE_LINK}
${structuredData({ slug, titleAr, descAr, url })}
</head>
<body class="no-js">
${SPRITE}
${HEADER}
${DRAWER}
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
