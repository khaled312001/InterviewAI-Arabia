/**
 * Printable CV templates.
 *
 * Every template is ONE column of real text with conventional headings,
 * because that is what ATS parsers read reliably: no tables for layout, no text
 * inside images, no icons standing in for words, contact details in the body
 * rather than a header/footer region some parsers skip. They differ only in
 * typography. The browser's "Save as PDF" turns the page into the file, which
 * keeps the text selectable — the property a parser actually needs.
 */

import { sanitizeCv } from './cv.js';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const HEADINGS = {
  en: { summary: 'Summary', experience: 'Experience', education: 'Education', skills: 'Skills', projects: 'Projects', certifications: 'Certifications', languages: 'Languages', present: 'Present', print: 'Print / Save as PDF', hint: 'In the print dialog choose “Save as PDF”. Turn off “Headers and footers”.' },
  ar: { summary: 'الملخص المهني', experience: 'الخبرات العملية', education: 'التعليم', skills: 'المهارات', projects: 'المشاريع', certifications: 'الشهادات', languages: 'اللغات', present: 'حتى الآن', print: 'طباعة / حفظ PDF', hint: 'اختر "حفظ كملف PDF" في نافذة الطباعة، وأوقف "الرؤوس والتذييلات".' },
  de: { summary: 'Profil', experience: 'Berufserfahrung', education: 'Ausbildung', skills: 'Kenntnisse', projects: 'Projekte', certifications: 'Zertifikate', languages: 'Sprachen', present: 'heute', print: 'Drucken / Als PDF speichern', hint: 'Im Druckdialog „Als PDF speichern“ wählen.' },
  fr: { summary: 'Profil', experience: 'Expérience professionnelle', education: 'Formation', skills: 'Compétences', projects: 'Projets', certifications: 'Certifications', languages: 'Langues', present: 'présent', print: 'Imprimer / Enregistrer en PDF', hint: 'Choisissez « Enregistrer au format PDF ».' },
  es: { summary: 'Perfil', experience: 'Experiencia', education: 'Formación', skills: 'Habilidades', projects: 'Proyectos', certifications: 'Certificaciones', languages: 'Idiomas', present: 'actualidad', print: 'Imprimir / Guardar PDF', hint: 'Elige «Guardar como PDF».' },
};

export const TEMPLATES = ['classic', 'modern', 'compact', 'executive', 'elegant', 'minimal', 'tech', 'bold', 'creative', 'emerald'];

/** Names and a one-line pitch per template, for the gallery in the app and on the site. */
export const TEMPLATE_META = {
  classic: { nameEn: 'Classic', nameAr: 'كلاسيكي', descEn: 'Serif, centred, timeless — fits any industry.', descAr: 'خط كلاسيكي في المنتصف — يناسب كل المجالات.' },
  modern: { nameEn: 'Modern', nameAr: 'عصري', descEn: 'Clean sans-serif with a blue accent.', descAr: 'خط حديث نظيف بلمسة زرقاء.' },
  compact: { nameEn: 'Compact', nameAr: 'مضغوط', descEn: 'Fits a long career on fewer pages.', descAr: 'يضع خبرة طويلة في صفحات أقل.' },
  executive: { nameEn: 'Executive', nameAr: 'تنفيذي', descEn: 'Large serif name, for senior roles.', descAr: 'اسم كبير بخط رسمي للمناصب القيادية.' },
  elegant: { nameEn: 'Elegant', nameAr: 'أنيق', descEn: 'Refined serif with a warm gold accent.', descAr: 'خط راقٍ بلمسة ذهبية دافئة.' },
  minimal: { nameEn: 'Minimal', nameAr: 'بسيط', descEn: 'Lots of white space, quiet grey rules.', descAr: 'مساحات بيضاء وخطوط رمادية هادئة.' },
  tech: { nameEn: 'Tech', nameAr: 'تقني', descEn: 'Monospace headings, teal accent — for engineers.', descAr: 'عناوين بخط برمجي ولون فيروزي — للمهندسين.' },
  bold: { nameEn: 'Bold', nameAr: 'جريء', descEn: 'A dark header band that stands out in a pile.', descAr: 'شريط علوي داكن يلفت النظر بين السير.' },
  creative: { nameEn: 'Creative', nameAr: 'إبداعي', descEn: 'Violet accent bars and skill tags.', descAr: 'خطوط بنفسجية وشارات للمهارات.' },
  emerald: { nameEn: 'Emerald', nameAr: 'زمرّدي', descEn: 'Fresh green accent, calm and professional.', descAr: 'لمسة خضراء هادئة واحترافية.' },
};
export const CV_LANGUAGES = Object.keys(HEADINGS);

function fmtDate(d, lang) {
  if (!d) return '';
  const [y, m] = d.split('-');
  if (!m) return y;
  try {
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : lang, { month: 'short', year: 'numeric' })
      .format(new Date(Date.UTC(Number(y), Number(m) - 1, 15)));
  } catch {
    return `${m}/${y}`;
  }
}

function range(start, end, current, h, lang) {
  const a = fmtDate(start, lang);
  const b = current ? h.present : fmtDate(end, lang);
  if (!a && !b) return '';
  return `${a}${a && b ? ' – ' : ''}${b}`;
}

const THEMES = {
  classic: {
    font: "'Georgia', 'Times New Roman', serif",
    fontAr: "'Noto Naskh Arabic', 'Amiri', serif",
    accent: '#111827', head: 'center', rule: '1px solid #111827', size: '10.5pt', name: '22pt', caps: true,
  },
  modern: {
    font: "'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
    fontAr: "'Cairo', 'Segoe UI', Tahoma, sans-serif",
    accent: '#1A56E8', head: 'start', rule: '2px solid #1A56E8', size: '10.5pt', name: '24pt', caps: false,
  },
  compact: {
    font: "'Inter', 'Segoe UI', Arial, sans-serif",
    fontAr: "'Cairo', 'Segoe UI', Tahoma, sans-serif",
    accent: '#0F172A', head: 'start', rule: '1px solid #CBD5E1', size: '9.5pt', name: '18pt', caps: true,
  },
  executive: {
    font: "'Garamond', 'Georgia', serif",
    fontAr: "'Noto Naskh Arabic', 'Amiri', serif",
    accent: '#7C2D12', head: 'center', rule: '0.5px solid #7C2D12', size: '11pt', name: '26pt', caps: true,
  },
  // The six below vary only in typography and colour too. "bold" fills the
  // header with colour, but the name and contact line stay real text in the
  // body flow, which parsers read; nothing moves into a header region.
  elegant: {
    font: "'Georgia', 'Times New Roman', serif",
    fontAr: "'Noto Naskh Arabic', 'Amiri', serif",
    accent: '#92400E', head: 'center', rule: '1px solid #D6A756', size: '10.5pt', name: '25pt', caps: true,
  },
  minimal: {
    font: "'Inter', 'Segoe UI', Arial, sans-serif",
    fontAr: "'Cairo', 'Segoe UI', Tahoma, sans-serif",
    accent: '#374151', head: 'start', rule: '1px solid #E5E7EB', size: '10pt', name: '22pt', caps: false, light: true,
  },
  tech: {
    font: "'Inter', 'Segoe UI', Arial, sans-serif",
    fontAr: "'Cairo', 'Segoe UI', Tahoma, sans-serif",
    accent: '#0F766E', head: 'start', rule: '1px dashed #0F766E', size: '10pt', name: '22pt', caps: false, mono: true, chips: true,
  },
  bold: {
    font: "'Inter', 'Segoe UI', Arial, sans-serif",
    fontAr: "'Cairo', 'Segoe UI', Tahoma, sans-serif",
    accent: '#1E293B', head: 'start', rule: '2px solid #1E293B', size: '10.5pt', name: '24pt', caps: true, band: true,
  },
  creative: {
    font: "'Inter', 'Segoe UI', Arial, sans-serif",
    fontAr: "'Cairo', 'Segoe UI', Tahoma, sans-serif",
    accent: '#6D28D9', head: 'start', rule: 'none', size: '10.5pt', name: '24pt', caps: false, bar: true, chips: true,
  },
  emerald: {
    font: "'Inter', 'Segoe UI', Arial, sans-serif",
    fontAr: "'Cairo', 'Segoe UI', Tahoma, sans-serif",
    accent: '#047857', head: 'start', rule: '2px solid #A7F3D0', size: '10.5pt', name: '23pt', caps: false,
  },
};

/** The CSS a theme adds on top of the shared sheet. */
function themeExtras(t, rtl) {
  const css = [];
  if (t.band) {
    css.push(`header { background: ${t.accent}; color: #fff; margin: -14mm -15mm 12px; padding: 12mm 15mm 9mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  header h1 { color: #fff; } header .headline { color: #CBD5E1; } header .contact, header .contact .sep { color: #E2E8F0; }
  @media print { header { margin: 0 0 12px; padding: 8mm 10mm; } }
  @media (max-width: 820px) { header { margin: -18px -18px 12px; padding: 22px 18px; } }`);
  }
  if (t.bar) {
    css.push(`h2 { border: 0; padding: 1px 0 1px; padding-inline-start: 8px; border-inline-start: 4px solid ${t.accent}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }`);
  }
  if (t.mono && !rtl) {
    css.push("h2 { font-family: 'JetBrains Mono', 'Consolas', 'Courier New', monospace; font-size: .95em; } h2::before { content: '// '; opacity: .6; }");
  }
  if (t.light) {
    css.push('h1 { font-weight: 600; } h2 { font-weight: 600; color: #6B7280; font-size: .9em; letter-spacing: .08em; text-transform: uppercase; } .page { padding-top: 18mm; }');
  }
  if (t.chips) {
    css.push(`.skills { line-height: 2; } .skills .chip { display: inline-block; border: 1px solid ${t.accent}; color: ${t.accent}; border-radius: 999px; padding: 0 8px; margin: 0 4px 4px 0; font-size: .92em; } .skills .dot { display: none; }`);
  }
  return css.join('\n  ');
}

/**
 * @param {object} cvInput
 * @param {{ template?: string, lang?: string, title?: string, toolbar?: boolean, autoPrint?: boolean }} [opts]
 */
export function renderCvHtml(cvInput, opts = {}) {
  const cv = sanitizeCv(cvInput);
  const lang = HEADINGS[opts.lang] ? opts.lang : 'en';
  const h = HEADINGS[lang];
  const t = THEMES[opts.template] || THEMES.classic;
  const rtl = lang === 'ar';
  const b = cv.basics;

  const contact = [b.location, b.phone, b.email, ...b.links.map((l) => l.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))]
    .filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('<span class="sep"> · </span>');

  const section = (title, body) => (body ? `<section><h2>${esc(title)}</h2>${body}</section>` : '');

  const exp = cv.experience.map((e) => `
    <div class="item">
      <div class="row"><div class="what"><strong>${esc(e.title)}</strong>${e.company ? `<span class="at">${rtl ? ' — ' : ', '}${esc(e.company)}</span>` : ''}${e.location ? `<span class="loc"> · ${esc(e.location)}</span>` : ''}</div>
      <div class="when">${esc(range(e.start, e.end, e.current, h, lang))}</div></div>
      ${e.bullets.length ? `<ul>${e.bullets.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    </div>`).join('');

  const edu = cv.education.map((e) => `
    <div class="item">
      <div class="row"><div class="what"><strong>${esc([e.degree, e.field].filter(Boolean).join(rtl ? '، ' : ', '))}</strong>${e.school ? `<span class="at">${rtl ? ' — ' : ', '}${esc(e.school)}</span>` : ''}${e.location ? `<span class="loc"> · ${esc(e.location)}</span>` : ''}</div>
      <div class="when">${esc(range(e.start, e.end, false, h, lang))}</div></div>
      ${e.details ? `<p class="details">${esc(e.details)}</p>` : ''}
    </div>`).join('');

  const projects = cv.projects.map((p) => `
    <div class="item">
      <div class="row"><div class="what"><strong>${esc(p.name)}</strong>${p.url ? `<span class="loc"> · ${esc(p.url.replace(/^https?:\/\//, ''))}</span>` : ''}</div></div>
      ${p.description ? `<p class="details">${esc(p.description)}</p>` : ''}
      ${p.bullets.length ? `<ul>${p.bullets.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    </div>`).join('');

  const certs = cv.certifications.length
    ? `<ul class="plain">${cv.certifications.map((c) => `<li><strong>${esc(c.name)}</strong>${c.issuer ? ` — ${esc(c.issuer)}` : ''}${c.date ? ` (${esc(fmtDate(c.date, lang))})` : ''}</li>`).join('')}</ul>`
    : '';
  const langs = cv.languages.length
    ? `<p>${cv.languages.map((l) => `${esc(l.name)}${l.level ? ` (${esc(l.level)})` : ''}`).join(rtl ? '، ' : ', ')}</p>`
    : '';
  const skills = cv.skills.length
    ? `<p class="skills">${cv.skills.map((x) => `<span class="chip">${esc(x)}</span>`).join('<span class="dot"> · </span>')}</p>`
    : '';

  const title = esc(opts.title || [b.name, b.headline].filter(Boolean).join(' — ') || 'CV');

  return `<!doctype html>
<html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=Inter:wght@400;600;700&family=Noto+Naskh+Arabic:wght@400;600;700&display=swap">
<style>
  @page { size: A4; margin: 14mm 15mm; }
  * { box-sizing: border-box; }
  html { background: #e5e7eb; }
  body { margin: 0; color: #111827; font-family: ${rtl ? t.fontAr : t.font}; font-size: ${t.size}; line-height: 1.45; }
  .page { background: #fff; width: 210mm; min-height: 297mm; margin: 16px auto; padding: 14mm 15mm; box-shadow: 0 2px 16px rgba(0,0,0,.12); }
  header { text-align: ${t.head === 'center' ? 'center' : 'start'}; margin-bottom: 10px; }
  h1 { font-size: ${t.name}; margin: 0; letter-spacing: ${t.caps && !rtl ? '.02em' : '0'}; color: ${t.accent}; font-weight: 700; }
  .headline { font-size: 1.15em; margin: 2px 0 6px; color: #374151; font-weight: 600; }
  .contact { color: #374151; font-size: .95em; }
  .contact .sep { color: #9ca3af; }
  section { margin-top: 12px; break-inside: auto; }
  h2 { font-size: 1.02em; margin: 0 0 6px; padding-bottom: 3px; border-bottom: ${t.rule}; color: ${t.accent};
       text-transform: ${t.caps && !rtl ? 'uppercase' : 'none'}; letter-spacing: ${t.caps && !rtl ? '.06em' : '0'}; font-weight: 700; }
  .item { margin-bottom: 8px; break-inside: avoid; }
  .row { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
  .what { flex: 1; }
  .when { white-space: nowrap; color: #4b5563; font-size: .95em; }
  .at { color: #111827; }
  .loc { color: #4b5563; }
  ul { margin: 3px 0 0; padding-inline-start: 18px; }
  li { margin: 1px 0; }
  ul.plain { padding-inline-start: 18px; }
  p { margin: 0; }
  .details { color: #374151; margin-top: 2px; }
  .skills { line-height: 1.6; }
  .toolbar { position: sticky; top: 0; z-index: 2; display: flex; gap: 12px; align-items: center; justify-content: center;
             padding: 10px 16px; background: #0f172a; color: #e2e8f0; font: 14px/1.4 system-ui, sans-serif; flex-wrap: wrap; }
  .toolbar button { background: #1A56E8; color: #fff; border: 0; border-radius: 8px; padding: 9px 16px; font: 600 14px system-ui, sans-serif; cursor: pointer; }
  @media print {
    html { background: #fff; }
    .toolbar { display: none; }
    .page { margin: 0; padding: 0; width: auto; min-height: 0; box-shadow: none; }
  }
  @media (max-width: 820px) { .page { width: auto; margin: 0; padding: 18px; min-height: 0; } .row { flex-direction: column; gap: 0; } }
  ${themeExtras(t, rtl)}
</style>
</head>
<body>
${opts.toolbar === false ? '' : `<div class="toolbar"><button type="button" onclick="window.print()">${esc(h.print)}</button><span>${esc(h.hint)}</span></div>`}
<div class="page">
  <header>
    <h1>${esc(b.name || '')}</h1>
    ${b.headline ? `<div class="headline">${esc(b.headline)}</div>` : ''}
    ${contact ? `<div class="contact">${contact}</div>` : ''}
  </header>
  ${section(h.summary, b.summary ? `<p>${esc(b.summary)}</p>` : '')}
  ${section(h.experience, exp)}
  ${section(h.education, edu)}
  ${section(h.skills, skills)}
  ${section(h.projects, projects)}
  ${section(h.certifications, certs)}
  ${section(h.languages, langs)}
</div>
${opts.autoPrint ? '<script>window.addEventListener("load",function(){document.fonts&&document.fonts.ready?document.fonts.ready.then(function(){setTimeout(function(){window.print()},300)}):setTimeout(function(){window.print()},800)})</script>' : ''}
</body>
</html>`;
}

/** A cover letter as a printable page in the same visual family. */
export function renderLetterHtml({ letter, cv, lang = 'en', template = 'classic' }) {
  const c = sanitizeCv(cv || {});
  const t = THEMES[template] || THEMES.classic;
  const rtl = lang === 'ar';
  const h = HEADINGS[lang] || HEADINGS.en;
  const paras = String(letter || '').split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  return `<!doctype html>
<html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(c.basics.name || 'Cover letter')}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=Inter:wght@400;600;700&display=swap">
<style>
 @page { size: A4; margin: 20mm; } html { background:#e5e7eb } body { margin:0; font-family:${rtl ? t.fontAr : t.font}; font-size:11pt; line-height:1.6; color:#111827 }
 .page { background:#fff; width:210mm; min-height:297mm; margin:16px auto; padding:20mm; box-shadow:0 2px 16px rgba(0,0,0,.12) }
 h1 { margin:0; font-size:18pt; color:${t.accent} } .contact { color:#4b5563; margin:4px 0 24px } p { margin:0 0 12px }
 .toolbar { position:sticky; top:0; display:flex; gap:12px; justify-content:center; align-items:center; padding:10px; background:#0f172a; color:#e2e8f0; font:14px system-ui }
 .toolbar button { background:#1A56E8; color:#fff; border:0; border-radius:8px; padding:9px 16px; font:600 14px system-ui; cursor:pointer }
 @media print { html{background:#fff} .toolbar{display:none} .page{margin:0; padding:0; width:auto; min-height:0; box-shadow:none} }
 @media (max-width:820px){ .page{width:auto; margin:0; padding:18px; min-height:0} }
</style></head><body>
<div class="toolbar"><button type="button" onclick="window.print()">${esc(h.print)}</button><span>${esc(h.hint)}</span></div>
<div class="page"><h1>${esc(c.basics.name)}</h1><div class="contact">${esc([c.basics.email, c.basics.phone, c.basics.location].filter(Boolean).join(' · '))}</div>${paras}</div>
</body></html>`;
}
