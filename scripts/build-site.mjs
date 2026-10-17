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
const OG_IMAGE = `${ORIGIN}/og-image-v3.png`;

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
function structuredData({ slug, titleEn, descEn, url }) {
  const isPost = slug.startsWith('blog-');
  const crumbs = [
    { '@type': 'ListItem', position: 1, name: 'Interprova', item: `${ORIGIN}/` },
  ];
  if (isPost) crumbs.push({ '@type': 'ListItem', position: 2, name: 'Blog', item: `${ORIGIN}/blog.html` });
  crumbs.push({ '@type': 'ListItem', position: crumbs.length + 1, name: titleEn, item: url });

  const graph = [{ '@type': 'BreadcrumbList', itemListElement: crumbs }];

  if (isPost) {
    graph.push({
      '@type': 'Article',
      headline: titleEn,
      description: descEn,
      inLanguage: ['en', 'ar'],
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      image: OG_IMAGE,
      author: { '@type': 'Organization', name: 'Interprova', url: `${ORIGIN}/` },
      publisher: { '@id': `${ORIGIN}/#org` },
    });
  }

  if (slug === 'contact') {
    graph.push({
      '@type': 'ContactPage',
      name: titleEn,
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

/**
 * "Explore the platform" — a strip of the other products, appended to every
 * generated page except checkout (where it would only be a way out of paying).
 * The tile for the page you are on is left out.
 */
const EXPLORE = [
  { href: '/#assistant', match: '', ico: 'i-headset', g: 'g-violet', en: ['Live Interview Assistant', 'Live help in the real interview, from your own CV.'], ar: ['المساعد المباشر للمقابلات', 'مساعدة لحظية في المقابلة الحقيقية من سيرتك أنت.'] },
  { href: '/cv-builder.html', match: 'cv-builder', ico: 'i-pen', g: 'g-amber', en: ['CV builder', 'One CV in, a tailored application out.'], ar: ['منشئ السيرة الذاتية', 'سيرة واحدة تدخل، وطلب مخصّص يخرج.'] },
  { href: '/jobs', match: 'jobs', ico: 'i-briefcase', g: 'g-cyan', en: ['Jobs worldwide', 'Live roles with your match on every listing.'], ar: ['وظائف حول العالم', 'وظائف حيّة مع نسبة تطابقك على كل وظيفة.'] },
  { href: '/ats-checker', match: 'ats-checker', ico: 'i-filecheck', g: 'g-green', en: ['ATS CV checker', 'Free — see what hiring software sees.'], ar: ['فاحص ATS', 'مجاني — شاهد ما تراه أنظمة التوظيف.'] },
  { href: '/integrations.html', match: 'integrations', ico: 'i-calendar', g: 'g-rose', en: ['Calendar & Google Meet', 'Interviews on your calendar, one tap from help.'], ar: ['التقويم و Google Meet', 'مقابلاتك في تقويمك، على بُعد ضغطة من المساعدة.'] },
  { href: '/desktop.html', match: 'desktop', ico: 'i-monitor', g: 'g-blue', en: ['Desktop app', 'Meeting AI for Windows and macOS.'], ar: ['تطبيق سطح المكتب', 'Meeting AI لويندوز وماك.'] },
  { href: '/features.html#interviews', match: 'features', ico: 'i-mic', g: 'g-blue', en: ['AI mock interviews', 'Rehearse by voice and get scored out of 10.'], ar: ['المقابلات التدريبية', 'تدرّب بصوتك واحصل على تقييم من ١٠.'] },
];
function explore(slug) {
  if (slug === 'checkout') return '';
  const tiles = EXPLORE.filter((t) => t.match !== slug).slice(0, 6);
  if (tiles.length % 3) tiles.pop();
  return `
<section class="section section-alt explore">
  <div class="wrap">
    <div class="sec-head">
      <div class="kicker"><span data-l="en">Explore the platform</span><span data-l="ar">اكتشف المنصة</span></div>
      <h2><span data-l="en">Everything between you and the offer</span><span data-l="ar">كل ما بينك وبين العرض الوظيفي</span></h2>
    </div>
    <div class="bento">
${tiles.map((t) => `      <a class="tile reveal" href="${t.href}">
        <span class="tico ${t.g}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#${t.ico}"/></svg></span>
        <h3><span data-l="en">${t.en[0]}</span><span data-l="ar">${t.ar[0]}</span></h3>
        <p><span data-l="en">${t.en[1]}</span><span data-l="ar">${t.ar[1]}</span></p>
      </a>`).join(String.fromCharCode(10))}
    </div>
  </div>
</section>`;
}

function layout({ slug, titleAr, titleEn, descAr, descEn, path: cleanPath, body }) {
  // A page the server routes at a clean path (`"path": "/jobs"` in its front
  // matter) is canonical there, not at its .html file.
  const url = cleanPath ? `${ORIGIN}${cleanPath}` : slug === 'index' ? `${ORIGIN}/` : `${ORIGIN}/${slug}.html`;
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<script>
// Same as the homepage's head script: theme and language before first paint,
// so ?lang=ar and a remembered Arabic choice open this page in Arabic too.
(function(){
  var d = document.documentElement;
  try {
    var t = localStorage.getItem('interprova-theme');
    if (t === 'light' || t === 'dark') d.setAttribute('data-theme', t);
  } catch (e) {}
  var l = null;
  try { l = new URLSearchParams(location.search).get('lang'); } catch (e) {}
  if (l !== 'ar' && l !== 'en') { try { l = localStorage.getItem('interprova-lang'); } catch (e) { l = null; } }
  if (l !== 'ar' && l !== 'en') l = 'en';
  d.setAttribute('lang', l);
  d.setAttribute('dir', l === 'en' ? 'ltr' : 'rtl');
})();
</script>
<title>${titleEn} — Interprova</title>
<meta name="description" content="${descEn}">
<meta name="author" content="Interprova">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="en" href="${url}">
<link rel="alternate" hreflang="ar" href="${url}?lang=ar">
<link rel="alternate" hreflang="x-default" href="${url}">
<link rel="manifest" href="/site.webmanifest">
<link rel="icon" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
${THEME_META}
<meta name="color-scheme" content="light dark">
<meta property="og:type" content="website">
<meta property="og:locale" content="en_US">
<meta property="og:locale:alternate" content="ar_AR">
<meta property="og:site_name" content="Interprova">
<meta property="og:title" content="${titleEn} — Interprova">
<meta property="og:description" content="${descEn}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${OG_IMAGE}">
<meta property="og:image:secure_url" content="${OG_IMAGE}">
<meta property="og:image:type" content="image/png">
<!-- Dimensions let WhatsApp and Facebook lay the card out from the markup
     alone; without them the preview reflows once the image finally lands, and
     some clients skip the image entirely rather than wait for it. -->
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Interprova — the AI career platform: jobs, CV and interviews">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${titleEn} — Interprova">
<meta name="twitter:description" content="${descEn}">
<meta name="twitter:image" content="${OG_IMAGE}">
${FONT_LINKS}
${STYLE_LINK}
${structuredData({ slug, titleEn, descEn, url })}
</head>
<body class="no-js">
${SPRITE}
${HEADER}
${DRAWER}
<main id="main">
${body}
${explore(slug)}
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
