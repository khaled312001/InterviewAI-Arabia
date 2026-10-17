/**
 * Printable CV templates — a design library, not one layout in many colours.
 *
 * Every DESIGN below has its own structure (where the name sits, how the page
 * is divided, what carries the colour) and its own CSS; a TEMPLATE is a design
 * dressed in a palette and a font pair. The gallery shows templates.
 *
 * What never changes, whatever the look: the text is real, selectable text in
 * reading order — the name and contact first, the main column before the side
 * column, headings are words (icons and shapes only sit beside them). That is
 * what an applicant-tracking system reads off a browser-made PDF. One-column
 * designs are marked `ats: 'best'`; two-column and heavily decorated ones
 * `ats: 'good'` — most parsers handle them, a few older ones read the columns
 * one after the other.
 *
 * Paper: `@page` has no margin, so colour can run to the edge; the page's own
 * padding is repeated on every sheet (`box-decoration-break: clone`), and the
 * decorations (side columns, corner shapes, frames) are `position: fixed` when
 * printing, which the browser repeats on every sheet.
 */

import { sanitizeCv } from './cv.js';
import { renderArt, ganttHtml, donutHtml } from './art.js';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const HEADINGS = {
  en: { summary: 'Profile', experience: 'Experience', education: 'Education', skills: 'Skills', projects: 'Projects', certifications: 'Certifications', languages: 'Languages', contact: 'Contact', present: 'Present', years: 'years of experience', roles: 'roles', skillsN: 'skills', career: 'Career timeline', share: 'Time in each role', yrs: 'yrs', mos: 'mos', print: 'Print / Save as PDF', hint: 'In the print dialog choose “Save as PDF”, turn off “Headers and footers” and turn on “Background graphics”.' },
  ar: { summary: 'الملخص المهني', experience: 'الخبرات العملية', education: 'التعليم', skills: 'المهارات', projects: 'المشاريع', certifications: 'الشهادات', languages: 'اللغات', contact: 'التواصل', present: 'حتى الآن', years: 'سنوات خبرة', roles: 'وظائف', skillsN: 'مهارة', career: 'المسار المهني', share: 'توزيع سنوات الخبرة', yrs: 'سنة', mos: 'شهر', print: 'طباعة / حفظ PDF', hint: 'اختر "حفظ كملف PDF"، وأوقف "الرؤوس والتذييلات"، وفعّل "رسومات الخلفية".' },
  de: { summary: 'Profil', experience: 'Berufserfahrung', education: 'Ausbildung', skills: 'Kenntnisse', projects: 'Projekte', certifications: 'Zertifikate', languages: 'Sprachen', contact: 'Kontakt', present: 'heute', years: 'Jahre Erfahrung', roles: 'Positionen', skillsN: 'Kenntnisse', career: 'Werdegang', share: 'Zeit je Position', yrs: 'J.', mos: 'Mon.', print: 'Drucken / Als PDF speichern', hint: 'Im Druckdialog „Als PDF speichern“ und „Hintergrundgrafiken“ wählen.' },
  fr: { summary: 'Profil', experience: 'Expérience professionnelle', education: 'Formation', skills: 'Compétences', projects: 'Projets', certifications: 'Certifications', languages: 'Langues', contact: 'Contact', present: 'présent', years: 'ans d’expérience', roles: 'postes', skillsN: 'compétences', career: 'Parcours', share: 'Temps par poste', yrs: 'ans', mos: 'mois', print: 'Imprimer / Enregistrer en PDF', hint: 'Choisissez « Enregistrer au format PDF » et activez « Graphiques d’arrière-plan ».' },
  es: { summary: 'Perfil', experience: 'Experiencia', education: 'Formación', skills: 'Habilidades', projects: 'Proyectos', certifications: 'Certificaciones', languages: 'Idiomas', contact: 'Contacto', present: 'actualidad', years: 'años de experiencia', roles: 'puestos', skillsN: 'habilidades', career: 'Trayectoria', share: 'Tiempo por puesto', yrs: 'años', mos: 'meses', print: 'Imprimir / Guardar PDF', hint: 'Elige «Guardar como PDF» y activa «Gráficos de fondo».' },
};
export const CV_LANGUAGES = Object.keys(HEADINGS);

/* ------------------------------------------------------------- fonts */

const FONTS = {
  inter: { head: 'Inter', body: 'Inter', gf: ['Inter:wght@300;400;500;600;700;800;900'], ar: 'Cairo' },
  poppins: { head: 'Poppins', body: 'Poppins', gf: ['Poppins:wght@300;400;500;600;700;800'], ar: 'Tajawal' },
  montserrat: { head: 'Montserrat', body: 'Open Sans', gf: ['Montserrat:wght@300;400;600;700;800;900', 'Open+Sans:wght@400;600;700'], ar: 'Cairo' },
  raleway: { head: 'Raleway', body: 'Lato', gf: ['Raleway:wght@300;500;600;700;800', 'Lato:wght@400;700'], ar: 'Tajawal' },
  playfair: { head: 'Playfair Display', body: 'Lato', gf: ['Playfair+Display:ital,wght@0,400;0,600;0,700;1,400', 'Lato:wght@300;400;700'], ar: 'Amiri' },
  merriweather: { head: 'Merriweather', body: 'Source Sans 3', gf: ['Merriweather:wght@300;400;700;900', 'Source+Sans+3:wght@400;600;700'], ar: 'Amiri' },
  garamond: { head: 'EB Garamond', body: 'EB Garamond', gf: ['EB+Garamond:wght@400;500;600;700'], ar: 'Amiri' },
  cormorant: { head: 'Cormorant Garamond', body: 'Montserrat', gf: ['Cormorant+Garamond:wght@400;500;600;700', 'Montserrat:wght@300;400;500;600'], ar: 'Amiri' },
  dmserif: { head: 'DM Serif Display', body: 'DM Sans', gf: ['DM+Serif+Display:ital@0;1', 'DM+Sans:wght@300;400;500;700'], ar: 'Amiri' },
  space: { head: 'Space Grotesk', body: 'Inter', gf: ['Space+Grotesk:wght@400;500;600;700', 'Inter:wght@400;500;600;700', 'JetBrains+Mono:wght@400;500'], ar: 'IBM Plex Sans Arabic' },
  archivo: { head: 'Archivo Black', body: 'Archivo', gf: ['Archivo+Black', 'Archivo:wght@400;500;600;700'], ar: 'Cairo' },
  bebas: { head: 'Bebas Neue', body: 'Inter', gf: ['Bebas+Neue', 'Inter:wght@400;500;600;700'], ar: 'Cairo' },
  syne: { head: 'Syne', body: 'Manrope', gf: ['Syne:wght@600;700;800', 'Manrope:wght@400;500;600;700'], ar: 'Readex Pro' },
  outfit: { head: 'Outfit', body: 'Outfit', gf: ['Outfit:wght@300;400;500;600;700;800'], ar: 'Readex Pro' },
  nunito: { head: 'Nunito', body: 'Nunito', gf: ['Nunito:wght@400;600;700;800;900'], ar: 'Almarai' },
  worksans: { head: 'Work Sans', body: 'Work Sans', gf: ['Work+Sans:wght@300;400;500;600;700'], ar: 'Readex Pro' },
  lora: { head: 'Lora', body: 'Lora', gf: ['Lora:ital,wght@0,400;0,500;0,600;0,700;1,400'], ar: 'Amiri' },
  fraunces: { head: 'Fraunces', body: 'Inter', gf: ['Fraunces:opsz,wght@9..144,400;9..144,600;9..144,800', 'Inter:wght@400;500;600;700'], ar: 'Amiri' },
};
const AR_GF = {
  Cairo: 'Cairo:wght@400;600;700;800;900',
  Tajawal: 'Tajawal:wght@300;400;500;700;800',
  // Amiri, not Noto Naskh: Noto Naskh draws the dots as separate marks, and the
  // text a PDF reader (or an ATS) pulls out of it comes back without them.
  Amiri: 'Amiri:wght@400;700',
  'IBM Plex Sans Arabic': 'IBM+Plex+Sans+Arabic:wght@400;500;600;700',
  Almarai: 'Almarai:wght@400;700;800',
  'Readex Pro': 'Readex+Pro:wght@300;400;500;600;700',
};
const SERIF = new Set(['Playfair Display', 'Merriweather', 'EB Garamond', 'Cormorant Garamond', 'DM Serif Display', 'Lora', 'Fraunces', 'Amiri']);
const stack = (f) => `'${f}', ${SERIF.has(f) ? "Georgia, 'Times New Roman', serif" : "'Segoe UI', Arial, sans-serif"}`;

/* -------------------------------------------------------------- icons */

const ICON = {
  mail: '<path d="M3 5h18v14H3z" fill="none" stroke="currentColor" stroke-width="2"/><path d="m3 6 9 7 9-7" fill="none" stroke="currentColor" stroke-width="2"/>',
  phone: '<path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" fill="currentColor"/>',
  pin: '<path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" fill="currentColor"/>',
  link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  linkedin: '<path d="M4 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM2.5 9h3v12h-3zM9 9h2.9v1.7h.04c.4-.76 1.4-1.7 3-1.7 3.1 0 3.6 2 3.6 4.7V21h-3v-6.4c0-1.5 0-3.4-2.1-3.4s-2.4 1.6-2.4 3.3V21H9z" fill="currentColor"/>',
  github: '<path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.4-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 3 .8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7 3.6 3.6 0 0 1 .1-2.7s.8-.3 2.8 1a9.6 9.6 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.3.2 2.3.1 2.6a3.9 3.9 0 0 1 1 2.7c0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2z" fill="currentColor"/>',
  globe: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" fill="none" stroke="currentColor" stroke-width="2"/>',
  // section icons
  summary: '<circle cx="12" cy="8" r="4" fill="currentColor"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z" fill="currentColor"/>',
  experience: '<path d="M9 4h6a2 2 0 0 1 2 2v1h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h3V6a2 2 0 0 1 2-2zm0 3h6V6H9z" fill="currentColor"/>',
  education: '<path d="M12 3 1 9l11 6 9-4.9V17h2V9zM5 13.2V17c0 1.7 3.1 3 7 3s7-1.3 7-3v-3.8l-7 3.8z" fill="currentColor"/>',
  skills: '<path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor"/>',
  projects: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="currentColor"/>',
  certifications: '<circle cx="12" cy="9" r="6" fill="currentColor"/><path d="m8 14-2 8 6-3 6 3-2-8" fill="currentColor"/>',
  languages: '<path d="M4 5h9M8.5 3v2M6 5c.6 3.4 2.6 6 6 7.5M11 5c-.6 3.6-3 6.6-7 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="m13 21 4-10 4 10M14.5 17.5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  career: '<path d="M4 6h9v3H4zM8 11h12v3H8zM6 16h8v3H6z" fill="currentColor"/>',
  share: '<path d="M11 3a9 9 0 1 0 9.9 10H11z" fill="currentColor"/><path d="M13 2v9h9a9 9 0 0 0-9-9z" fill="currentColor"/>',
  contact: '<path d="M3 5h18v14H3z" fill="currentColor"/><path d="m3 6 9 7 9-7" fill="none" stroke="#fff" stroke-width="2"/>',
};
const icon = (name, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name] || ''}</svg>`;

/* ------------------------------------------------------------ helpers */

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

function initials(name) {
  return String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => [...p][0]).join('').toUpperCase();
}

/** "Emma Carter" → ["Emma", "Carter"]; one word stays whole. */
function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return [parts[0] || '', ''];
  return [parts.slice(0, -1).join(' '), parts[parts.length - 1]];
}

function contactItems(b) {
  const items = [];
  if (b.email) items.push(['mail', b.email]);
  if (b.phone) items.push(['phone', b.phone]);
  if (b.location) items.push(['pin', b.location]);
  for (const l of b.links) {
    const text = l.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
    const kind = /linkedin\.com/i.test(text) ? 'linkedin' : /github\.com/i.test(text) ? 'github' : /^[^/]+$/.test(text) ? 'globe' : 'link';
    items.push([kind, text]);
  }
  return items;
}

/** The level the person wrote, as 1–5 dots — only when it is a level we recognise. */
function levelDots(level) {
  const l = String(level || '').toLowerCase();
  let n = 0;
  if (/native|mother|bilingual|c2|اللغة الأم|لغة أم|الأم/.test(l)) n = 5;
  else if (/fluent|proficient|c1|طلاق|ممتاز|متقدم جدا/.test(l)) n = 5;
  else if (/advanced|full professional|b2|متقدم|جيد جدا/.test(l)) n = 4;
  else if (/intermediate|conversational|working|b1|متوسط|جيد/.test(l)) n = 3;
  else if (/basic|elementary|beginner|a1|a2|مبتدئ|أساسي/.test(l)) n = 2;
  return n;
}

function isDark(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return true;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.4;
}

function yearsOf(cv) {
  let months = 0;
  const now = new Date();
  for (const e of cv.experience) {
    if (!e.start) continue;
    const [sy, sm] = e.start.split('-').map(Number);
    const [ey, em] = e.current || !e.end ? [now.getUTCFullYear(), now.getUTCMonth() + 1] : e.end.split('-').map(Number);
    const m = (ey - sy) * 12 + ((em || 12) - (sm || 1));
    if (m > 0) months = Math.max(months, 0) + m;
  }
  return Math.floor(months / 12);
}

/* ------------------------------------------------------------ sections */

function blocks(cv, h, lang, v) {
  const rtl = lang === 'ar';
  const b = cv.basics;

  const item = (title, org, loc, when, body) => `
    <div class="item"><div class="when-col">${esc(when)}</div><div class="item-main">
      <div class="row"><div class="what"><div class="ttl">${esc(title)}</div>${org || loc ? `<div class="org">${org ? `<span class="co">${esc(org)}</span>` : ''}${org && loc ? '<span class="sep"> · </span>' : ''}${loc ? `<span class="loc">${esc(loc)}</span>` : ''}</div>` : ''}</div>
      ${when ? `<div class="when">${esc(when)}</div>` : ''}</div>
      ${body}
    </div></div>`;
  const list = (xs) => (xs.length ? `<ul class="bul">${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');

  const skills = (style) => {
    if (!cv.skills.length) return '';
    if (style === 'inline') return `<p class="skills inline">${cv.skills.map((x) => `<span>${esc(x)}</span>`).join('<span class="sep"> · </span>')}</p>`;
    if (style === 'list') return `<ul class="skills list">${cv.skills.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    if (style === 'grid') return `<ul class="skills grid">${cv.skills.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    return `<div class="skills tags ${style}">${cv.skills.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>`;
  };

  const photo = b.photo
    ? `<div class="avatar photo"><img src="${esc(b.photo)}" alt=""></div>`
    : (b.name ? `<div class="avatar mono" aria-hidden="true"><span>${esc(initials(b.name))}</span></div>` : '');

  const years = yearsOf(cv);
  return {
    photo,
    summary: b.summary ? `<p class="summary">${esc(b.summary)}</p>` : '',
    experience: cv.experience.map((e) => item(e.title, e.company, e.location, range(e.start, e.end, e.current, h, lang), list(e.bullets))).join(''),
    education: cv.education.map((e) => item(
      [e.degree, e.field].filter(Boolean).join(rtl ? '، ' : ', '), e.school, e.location, range(e.start, e.end, false, h, lang),
      e.details ? `<p class="details">${esc(e.details)}</p>` : '',
    )).join(''),
    projects: cv.projects.map((p) => `
      <div class="item proj"><div class="item-main">
        <div class="row"><div class="what"><div class="ttl">${esc(p.name)}</div>${p.url ? `<div class="org"><span class="loc">${esc(p.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</span></div>` : ''}</div></div>
        ${p.description ? `<p class="details">${esc(p.description)}</p>` : ''}${list(p.bullets)}
      </div></div>`).join(''),
    certifications: cv.certifications.length
      ? `<ul class="certs">${cv.certifications.map((c) => `<li><span class="ttl-s">${esc(c.name)}</span>${c.issuer ? `<span class="muted"> — ${esc(c.issuer)}</span>` : ''}${c.date ? `<span class="muted"> · ${esc(fmtDate(c.date, lang))}</span>` : ''}</li>`).join('')}</ul>`
      : '',
    languages: cv.languages.length
      ? `<ul class="langs">${cv.languages.map((l) => {
        const n = levelDots(l.level);
        return `<li><span class="ln">${esc(l.name)}</span>${l.level ? `<span class="lvl">${esc(l.level)}</span>` : ''}${n ? `<span class="dots" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>` : ''}</li>`;
      }).join('')}</ul>`
      : '',
    skills,
    contact: (cls = '') => {
      const items = contactItems(b);
      return items.length ? `<ul class="contact ${cls}">${items.map(([k, val]) => `<li><span class="ci">${icon(k)}</span><span class="cv">${esc(val)}</span></li>`).join('')}</ul>` : '';
    },
    kpis: [
      years ? [`${years}+`, h.years] : null,
      cv.experience.length ? [String(cv.experience.length), h.roles] : null,
      cv.skills.length ? [String(cv.skills.length), h.skillsN] : null,
    ].filter(Boolean),
  };
}

/* --------------------------------------------------------- base CSS */

function baseCss(v, rtl) {
  const f = FONTS[v.font] || FONTS.inter;
  const head = rtl ? f.ar : f.head;
  const body = rtl ? f.ar : f.body;
  return `
  :root { --acc: ${v.acc}; --acc2: ${v.acc2 || v.acc}; --tint: ${v.tint}; --dark: ${v.dark || '#111827'}; --ink: ${v.ink || '#1F2937'};
          --muted: ${v.muted || '#6B7280'}; --rule: ${v.rule || '#E5E7EB'}; --paper: ${v.paper || '#fff'};
          --head: ${stack(head)}; --body: ${stack(body)}; --px: 15mm; --pt: 13mm; --pb: 13mm; }
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html { background: #DDE1E7; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; color: var(--ink); font-family: var(--body); font-size: ${(v.size || 10) + (rtl && f.ar === 'Amiri' ? 1 : 0)}pt; line-height: ${rtl ? 1.62 : 1.48}; }
  .page { position: relative; background: var(--paper); width: 210mm; min-height: 297mm; margin: 18px auto; box-shadow: 0 6px 30px rgba(15,23,42,.18);
          padding: var(--pt) 0 var(--pb); -webkit-box-decoration-break: clone; box-decoration-break: clone; overflow: hidden; }
  .deco { position: absolute; inset: 0; pointer-events: none; z-index: 0; }
  .deco > * { position: absolute; }
  .content { position: relative; z-index: 1; }
  h1 { font-family: var(--head); margin: 0; line-height: 1.05; font-weight: 800; color: var(--dark); }
  .headline { font-family: var(--head); font-weight: 600; color: var(--acc); margin-top: 6px; }
  h2 { font-family: var(--head); font-size: 1.08em; margin: 0 0 9px; color: var(--dark); font-weight: 700; display: flex; align-items: center; gap: 8px; }
  h2 .hi { display: none; }
  section { margin-top: 16px; }
  .item { margin-bottom: 11px; break-inside: avoid; display: block; }
  .item .when-col { display: none; }
  .row { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
  .what { flex: 1; min-width: 0; }
  .ttl { font-weight: 700; color: var(--dark); font-size: 1.05em; }
  .org { color: var(--acc); font-weight: 600; font-size: .96em; }
  .org .loc, .org .sep { color: var(--muted); font-weight: 400; }
  .when { white-space: nowrap; color: var(--muted); font-size: .9em; font-weight: 500; }
  ul.bul { margin: 4px 0 0; padding-inline-start: 16px; }
  ul.bul li { margin: 2px 0; }
  ul.bul li::marker { color: var(--acc); }
  p { margin: 0; }
  .summary { color: var(--ink); }
  .details { color: var(--muted); margin-top: 3px; }
  .ttl-s { font-weight: 600; } .muted { color: var(--muted); }
  ul.certs { margin: 0; padding-inline-start: 16px; } ul.certs li { margin: 3px 0; } ul.certs li::marker { color: var(--acc); }
  ul.langs { list-style: none; padding: 0; margin: 0; }
  ul.langs li { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 0 10px; padding: 3px 0; }
  ul.langs .ln { font-weight: 600; }
  ul.langs .lvl { color: var(--muted); font-size: .9em; }
  ul.langs .dots { grid-column: 1 / -1; display: flex; gap: 4px; margin-top: 3px; }
  ul.langs .dots i { width: 9px; height: 9px; border-radius: 50%; background: var(--rule); }
  ul.langs .dots i.on { background: var(--acc); }
  ul.langs li:has(.dots) .lvl { display: none; }
  ul.langs li:has(.dots) { grid-template-columns: 1fr auto; }
  ul.langs li:has(.dots) .dots { grid-column: 2; grid-row: 1; margin: 0; }
  .ic { width: 1em; height: 1em; flex: none; }
  ul.contact { list-style: none; margin: 0; padding: 0; }
  ul.contact li { display: flex; align-items: center; gap: 8px; margin: 0; overflow-wrap: anywhere; }
  ul.contact .ci { display: inline-flex; color: var(--acc); }
  ul.contact.inline { display: flex; flex-wrap: wrap; gap: 5px 16px; font-size: .94em; }
  .skills.inline .sep { color: var(--muted); }
  .skills.tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .skills .chip { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: .88em; line-height: 1.45; background: var(--tint); color: var(--dark); font-weight: 500; }
  .skills.outline .chip { background: transparent; border: 1px solid var(--acc); color: var(--acc); }
  .skills.solid .chip { background: var(--acc); color: #fff; }
  .skills.square .chip { border-radius: 4px; }
  ul.skills { list-style: none; padding: 0; margin: 0; }
  ul.skills.grid { columns: 3; column-gap: 18px; }
  ul.skills li { position: relative; padding-inline-start: 14px; margin: 3px 0; break-inside: avoid; }
  ul.skills li::before { content: ''; position: absolute; inset-inline-start: 0; top: .6em; width: 6px; height: 6px; border-radius: 50%; background: var(--acc); }
  .avatar { width: 120px; height: 120px; border-radius: 50%; overflow: hidden; flex: none; display: grid; place-items: center; }
  .avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .avatar.mono { background: var(--tint); color: var(--acc); font-family: var(--head); font-weight: 700; font-size: 34pt; letter-spacing: ${rtl ? 0 : '.02em'}; }
  .art { position: absolute; pointer-events: none; z-index: 0; }
  .art-svg { display: block; overflow: visible; }
  .page > .deco .art { position: absolute; }
  .art-host { position: relative; isolation: isolate; overflow: hidden; }
  .art-host > :not(.art) { position: relative; z-index: 1; }
  h1.has-art { position: relative; isolation: isolate; display: inline-block; }
  h1.has-art .art { z-index: -1; }
  h1.has-art .art-brush { top: 30% !important; bottom: -18% !important; left: -5% !important; right: -8% !important; width: auto !important; height: auto !important; }
  .art-inline { position: relative !important; margin: 8px auto 2px; }
  /* charts */
  .gantt { display: grid; gap: 6px; font-size: .86em; }
  .g-row { display: grid; grid-template-columns: 30mm 1fr; gap: 10px; align-items: center; }
  .g-lab { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: var(--dark); }
  .g-track { position: relative; height: 12px; background: var(--tint); border-radius: 6px; }
  .g-bar { position: absolute; top: 0; bottom: 0; border-radius: 6px; background: var(--acc); }
  .g-bar.g1 { background: var(--acc2); } .g-bar.g2 { background: var(--acc); opacity: .7; } .g-bar.g3 { background: var(--acc2); opacity: .7; }
  .g-axis .g-track { background: none; height: 14px; border-top: 1px solid var(--rule); border-radius: 0; }
  .g-axis b { position: absolute; top: 2px; transform: translateX(${rtl ? '50%' : '-50%'}); font-weight: 500; color: var(--muted); font-size: .9em; }
  .donut { display: flex; gap: 14px; align-items: center; }
  .d-ring { position: relative; width: 30mm; flex: none; }
  .d-ring svg { display: block; width: 100%; transform: rotate(0deg); }
  .d-mid { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; line-height: 1; }
  .d-mid b { font-family: var(--head); font-size: 17pt; color: var(--dark); } .d-mid span { font-size: .78em; color: var(--muted); margin-top: 2px; }
  ul.d-legend { list-style: none; margin: 0; padding: 0; flex: 1; min-width: 0; font-size: .88em; }
  ul.d-legend li { display: grid; grid-template-columns: 10px 1fr auto; gap: 7px; align-items: center; padding: 2px 0; }
  ul.d-legend i { width: 10px; height: 10px; border-radius: 3px; }
  .dl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .dv { color: var(--muted); }
  .donut.stacked { flex-direction: column; align-items: stretch; } .donut.stacked .d-ring { width: 32mm; margin: 0 auto 4px; }
  .kpis-strip { display: flex; gap: 10px; margin-top: 14px; }
  .kpis-strip .kpi { flex: 1; text-align: center; padding: 10px 6px; border-radius: 12px; background: var(--tint); }
  .kpis-strip .kpi b { display: block; font-family: var(--head); font-size: 20pt; line-height: 1.05; color: var(--acc); }
  .kpis-strip .kpi span { font-size: .82em; color: var(--muted); }
  .kpis-strip.rings .kpi { background: none; padding: 0; display: flex; flex-direction: column; align-items: center; }
  .kpis-strip.rings .kpi b { width: 22mm; height: 22mm; border-radius: 50%; display: grid; place-items: center; border: 3px solid var(--acc); box-shadow: inset 0 0 0 4px var(--tint); font-size: 17pt; margin-bottom: 4px; }
  /* language levels as a segmented bar */
  .lang-bars ul.langs li:has(.dots) { grid-template-columns: 1fr auto; }
  .lang-bars ul.langs li:has(.dots) .lvl { display: block; }
  .lang-bars ul.langs li:has(.dots) .dots { grid-column: 1 / -1; grid-row: 2; gap: 3px; margin-top: 4px; }
  .lang-bars ul.langs .dots i { flex: 1; width: auto; height: 6px; border-radius: 3px; }
  .toolbar { position: sticky; top: 0; z-index: 50; display: flex; gap: 12px; align-items: center; justify-content: center;
             padding: 10px 16px; background: #0f172a; color: #e2e8f0; font: 14px/1.4 system-ui, sans-serif; flex-wrap: wrap; }
  .toolbar button { background: #1A56E8; color: #fff; border: 0; border-radius: 8px; padding: 9px 16px; font: 600 14px system-ui, sans-serif; cursor: pointer; }
  @media print {
    html { background: var(--paper); }
    .toolbar { display: none; }
    .page { margin: 0; width: auto; min-height: 0; box-shadow: none; overflow: visible; }
    .deco > * { position: fixed; }
  }
  @media screen and (max-width: 820px) {
    .page { width: auto; margin: 0; min-height: 0; }
    :root { --px: 18px; --pt: 18px; --pb: 18px; }
    .row { flex-direction: column; gap: 0; }
    .cols { display: block !important; }
    .cols > * { padding-inline: var(--px) !important; }
    .deco { display: none; }
    .page { background: var(--paper) !important; }
  }`;
}

/* ------------------------------------------------------------ designs */

/**
 * Each design: { columns, ats, html(ctx), css(ctx) }.
 * ctx: { v, s, h, b, rtl, sec, start, end }
 */
/** A chart the template asked for (v.charts), as its own section. */
const chart = (ctx, kind, opts = {}) => {
  if (!(ctx.v.charts || []).includes(kind)) return '';
  if (kind === 'gantt') return ctx.sec('career', ctx.h.career, ganttHtml(ctx.cv));
  if (kind === 'donut') {
    const d = donutHtml(ctx.cv, ctx.pal, ctx.h);
    return ctx.sec('share', ctx.h.share, opts.stacked ? d.replace('class="donut"', 'class="donut stacked"') : d);
  }
  if (kind === 'kpis' && ctx.s.kpis.length) {
    return `<div class="kpis-strip ${ctx.v.kpiStyle || ''}">${ctx.s.kpis.map(([n, l]) => `<div class="kpi"><b>${esc(n)}</b><span>${esc(l)}</span></div>`).join('')}</div>`;
  }
  return '';
};
const sideSecs = (ctx, which = ['contact', 'skills', 'languages', 'certifications'], skillStyle = 'list') => which.map((k) => {
  const { s, h, sec } = ctx;
  if (k === 'contact') return sec('contact', h.contact, s.contact('stack'));
  if (k === 'skills') return chart(ctx, 'donut', { stacked: true }) + sec('skills', h.skills, s.skills(skillStyle));
  if (k === 'languages') return sec('languages', h.languages, s.languages);
  if (k === 'certifications') return sec('certifications', h.certifications, s.certifications);
  return '';
}).join('');
const mainSecs = (ctx, which = ['summary', 'experience', 'projects', 'education']) => which.map((k) => {
  const body = ctx.sec(k, ctx.h[k], ctx.s[k]);
  if (k === 'summary') return body + chart(ctx, 'kpis');
  if (k === 'experience') return (which.includes('summary') ? '' : chart(ctx, 'kpis')) + chart(ctx, 'gantt') + body;
  return body;
}).join('');
const oneColumn = (ctx, skillStyle) => mainSecs(ctx, ['summary', 'experience']) + chart(ctx, 'donut') + ctx.sec('skills', ctx.h.skills, ctx.s.skills(skillStyle))
  + mainSecs(ctx, ['projects', 'education']) + ctx.sec('certifications', ctx.h.certifications, ctx.s.certifications) + ctx.sec('languages', ctx.h.languages, ctx.s.languages);
const h1Open = (ctx) => {
  const art = ctx.art('name');
  return art ? `<h1 class="has-art">${art}` : '<h1>';
};
const nameBlock = (ctx) => `${h1Open(ctx)}${esc(ctx.b.name || '')}</h1>${ctx.b.headline ? `<div class="headline">${esc(ctx.b.headline)}</div>` : ''}`;
const splitNameBlock = (ctx) => {
  const [first, last] = splitName(ctx.b.name);
  return `${h1Open(ctx)}<span class="n1">${esc(first)}</span>${last ? ` <span class="n2">${esc(last)}</span>` : ''}</h1>${ctx.b.headline ? `<div class="headline">${esc(ctx.b.headline)}</div>` : ''}`;
};

const DESIGNS = {
  /* ---------------------------------------------- 1. Classic (ATS) */
  classic: {
    columns: 1, ats: 'best',
    html: (c) => `<div class="content" style="padding:0 var(--px)"><header class="hd">${nameBlock(c)}${c.s.contact('inline')}</header>${oneColumn(c, 'inline')}</div>`,
    css: (c) => `
      .hd { text-align: center; padding-bottom: 10px; border-bottom: 2px solid var(--dark); }
      h1 { font-size: 26pt; ${c.rtl ? '' : 'letter-spacing: .06em; text-transform: uppercase;'} font-weight: 700; }
      .headline { color: var(--ink); ${c.rtl ? '' : 'letter-spacing: .14em; text-transform: uppercase; font-size: .9em;'} }
      ul.contact.inline { justify-content: center; margin-top: 8px; color: var(--ink); }
      h2 { justify-content: center; border-bottom: 1px solid var(--rule); padding-bottom: 5px; ${c.rtl ? '' : 'letter-spacing: .16em; text-transform: uppercase; font-size: .92em;'} }`,
  },

  /* ---------------------------------------------- 2. Modern rule (ATS) */
  modern: {
    columns: 1, ats: 'best',
    html: (c) => `<div class="content" style="padding:0 var(--px)"><header class="hd"><div>${nameBlock(c)}</div>${c.s.contact('stack')}</header>${oneColumn(c, 'tags')}</div>`,
    css: () => `
      .hd { display: grid; grid-template-columns: 1fr auto; gap: 20px; align-items: end; padding-bottom: 14px; border-bottom: 4px solid var(--acc); }
      h1 { font-size: 30pt; letter-spacing: -.02em; }
      .headline { font-size: 1.15em; }
      .hd ul.contact { font-size: .9em; } .hd ul.contact li { justify-content: flex-end; margin: 2px 0; flex-direction: row-reverse; }
      h2 { color: var(--acc); }
      h2::after { content: ''; flex: 1; height: 1.5px; background: var(--rule); }`,
  },

  /* ---------------------------------------------- 3. Executive serif (ATS) */
  executive: {
    columns: 1, ats: 'best',
    html: (c) => `<div class="content" style="padding:0 calc(var(--px) + 3mm)"><header class="hd">${nameBlock(c)}<div class="orn"><span></span></div>${c.s.contact('inline')}</header>${oneColumn(c, 'inline')}</div>`,
    css: (c) => `
      .hd { text-align: center; }
      h1 { font-size: 32pt; font-weight: 600; color: var(--acc); ${c.rtl ? '' : 'letter-spacing: .04em;'} }
      .headline { color: var(--ink); font-weight: 500; ${c.rtl ? '' : 'font-style: italic;'} font-size: 1.15em; }
      .orn { display: flex; align-items: center; gap: 10px; margin: 10px auto 8px; width: 60%; }
      .orn::before, .orn::after { content: ''; flex: 1; border-top: 3px double var(--acc); }
      .orn span { width: 8px; height: 8px; transform: rotate(45deg); background: var(--acc); }
      ul.contact.inline { justify-content: center; }
      h2 { color: var(--acc); font-weight: 600; ${c.rtl ? '' : 'font-variant: small-caps; letter-spacing: .08em; font-size: 1.2em;'} border-bottom: 1px solid var(--acc); padding-bottom: 3px; }`,
  },

  /* ---------------------------------------------- 4. Minimal (ATS) */
  minimal: {
    columns: 1, ats: 'best',
    html: (c) => `<div class="content" style="padding:6mm calc(var(--px) + 4mm) 0"><header class="hd">${nameBlock(c)}${c.s.contact('inline')}</header>${oneColumn(c, 'inline')}</div>`,
    css: (c) => `
      h1 { font-size: 28pt; font-weight: 300; letter-spacing: ${c.rtl ? 0 : '-.01em'}; }
      .headline { color: var(--muted); font-weight: 400; }
      ul.contact.inline { margin-top: 12px; color: var(--muted); } ul.contact .ci { color: var(--muted); }
      section { margin-top: 22px; }
      h2 { font-weight: 600; color: var(--muted); font-size: .82em; ${c.rtl ? '' : 'letter-spacing: .2em; text-transform: uppercase;'} }
      .ttl { font-weight: 600; } .org { color: var(--ink); font-weight: 400; }`,
  },

  /* ---------------------------------------------- 5. Rail: headings in a left column (ATS) */
  rail: {
    columns: 1, ats: 'best',
    html: (c) => `<div class="content" style="padding:0 var(--px)"><header class="hd"><div>${splitNameBlock(c)}</div>${c.s.contact('stack')}</header>${oneColumn(c, 'grid')}</div>`,
    css: (c) => `
      .hd { display: grid; grid-template-columns: 1fr auto; gap: 18px; align-items: center; padding-bottom: 12px; border-bottom: 1px solid var(--rule); }
      h1 { font-size: 28pt; } h1 .n1 { font-weight: 300; } h1 .n2 { font-weight: 800; color: var(--acc); }
      .hd ul.contact { font-size: .9em; } .hd ul.contact li { margin: 2px 0; }
      section { display: grid; grid-template-columns: 36mm 1fr; gap: 0 7mm; margin-top: 15px; }
      section h2 { font-size: .8em; margin-top: 3px; color: var(--acc); ${c.rtl ? '' : 'letter-spacing: .16em; text-transform: uppercase;'} align-items: flex-start; }
      section > div { border-inline-start: 2px solid var(--tint); padding-inline-start: 7mm; }`,
  },

  /* ---------------------------------------------- 6. Dates column + timeline */
  chrono: {
    columns: 1, ats: 'best',
    html: (c) => `<div class="content" style="padding:0 var(--px)"><header class="hd"><div class="id">${splitNameBlock(c)}</div>${c.s.contact('inline')}</header>${oneColumn(c, 'tags')}</div>`,
    css: (c) => `
      .hd { padding-bottom: 12px; }
      h1 { font-size: 34pt; letter-spacing: ${c.rtl ? 0 : '-.02em'}; } h1 .n1 { font-weight: 400; color: var(--ink); } h1 .n2 { color: var(--acc); }
      .headline { ${c.rtl ? '' : 'text-transform: uppercase; letter-spacing: .14em; font-size: .9em;'} color: var(--muted); }
      ul.contact.inline { margin-top: 10px; padding: 8px 12px; background: var(--tint); border-radius: 8px; }
      h2 { color: var(--acc); } h2 .hi { display: inline-flex; width: 24px; height: 24px; border-radius: 50%; background: var(--acc); color: #fff; place-items: center; justify-content: center; align-items: center; }
      h2 .hi .ic { width: 13px; height: 13px; }
      .s-experience .item, .s-education .item { display: grid; grid-template-columns: 30mm 1fr; gap: 0 18px; position: relative; margin-bottom: 0; padding-bottom: 12px; }
      .s-experience .item .when-col, .s-education .item .when-col { display: block; color: var(--acc); font-weight: 600; font-size: .88em; padding-top: 2px; text-align: end; }
      .s-experience .item .when, .s-education .item .when { display: none; }
      .s-experience .item-main, .s-education .item-main { border-inline-start: 2px solid var(--tint); padding-inline-start: 16px; position: relative; }
      .s-experience .item-main::before, .s-education .item-main::before { content: ''; position: absolute; inset-inline-start: -7px; top: 4px; width: 12px; height: 12px; border-radius: 50%; background: var(--paper); border: 3px solid var(--acc); }`,
  },

  /* ---------------------------------------------- 7. Editorial: huge stacked name, magazine columns */
  editorial: {
    columns: 2, ats: 'good',
    html: (c) => `<div class="content" style="padding:0 var(--px)">
      <header class="hd art-host">${c.art('header')}<div class="id">${splitNameBlock(c)}</div><div class="meta">${c.s.contact('stack')}</div></header>
      <div class="cols"><main>${mainSecs(c)}</main><aside>${sideSecs(c, ['skills', 'languages', 'certifications'], 'list')}</aside></div></div>`,
    css: (c) => `
      .hd { display: grid; grid-template-columns: 1fr 62mm; gap: 10mm; align-items: end; padding-bottom: 8mm; border-bottom: 6px solid var(--dark); }
      h1 { font-size: 44pt; line-height: .92; ${c.rtl ? '' : 'letter-spacing: -.03em; text-transform: uppercase;'} }
      h1 span { display: block; } h1 .n1 { font-weight: 400; } h1 .n2 { color: var(--acc); }
      .headline { color: var(--ink); margin-top: 10px; font-size: 1.1em; }
      .meta { font-size: .9em; border-inline-start: 1px solid var(--rule); padding-inline-start: 6mm; } .meta li { margin: 3px 0; }
      .cols { display: grid; grid-template-columns: 1fr 58mm; gap: 0 9mm; }
      aside { border-inline-start: 1px solid var(--rule); padding-inline-start: 7mm; }
      h2 { ${c.rtl ? '' : 'text-transform: uppercase; letter-spacing: .14em; font-size: .85em;'} border-top: 2px solid var(--dark); padding-top: 6px; }
      .s-summary .summary { font-family: var(--head); font-size: 1.12em; line-height: 1.5; color: var(--dark); }`,
  },

  /* ---------------------------------------------- 8. Sidebar with photo/monogram */
  sidebar: {
    columns: 2, ats: 'good',
    html: (c) => `<div class="deco"><div class="side">${c.art('side')}</div></div>
      <div class="content cols"><main>${nameBlockHd(c)}${mainSecs(c)}</main>
      <aside>${c.s.photo}${sideSecs(c, ['contact', 'skills', 'languages', 'certifications'], c.v.sideSkills || 'tags')}</aside></div>`,
    css: (c) => {
      const dark = isDark(c.v.side);
      const ink = dark ? '#fff' : c.v.dark;
      return `
      .deco .side { overflow: hidden; top: 0; bottom: 0; ${c.start}: 0; width: 72mm; background: ${c.v.sideGrad ? `linear-gradient(170deg, ${c.v.side}, ${c.v.sideGrad})` : c.v.side}; }
      .cols { display: grid; grid-template-columns: 72mm 1fr; }
      main { grid-column: 2; grid-row: 1; padding: 0 var(--px) 0 10mm; padding-inline: 10mm var(--px); }
      aside { grid-column: 1; grid-row: 1; padding: 0 9mm; color: ${ink}; }
      aside .avatar { margin: 0 auto 8mm; width: 128px; height: 128px; box-shadow: 0 0 0 5px ${dark ? 'rgba(255,255,255,.18)' : '#fff'}, 0 0 0 7px var(--acc); }
      aside .avatar.mono { background: ${dark ? 'rgba(255,255,255,.1)' : '#fff'}; color: ${dark ? '#fff' : 'var(--acc)'}; }
      aside h2 { color: ${ink}; font-size: .95em; ${c.rtl ? '' : 'letter-spacing: .14em; text-transform: uppercase;'} border-bottom: 1px solid ${dark ? 'rgba(255,255,255,.28)' : 'rgba(0,0,0,.14)'}; padding-bottom: 6px; }
      aside section:first-of-type { margin-top: 0; }
      aside ul.contact li { margin: 7px 0; font-size: .92em; align-items: flex-start; }
      aside ul.contact .ci { width: 22px; height: 22px; border-radius: 50%; background: ${dark ? 'rgba(255,255,255,.14)' : '#fff'}; color: ${dark ? '#fff' : 'var(--acc)'}; justify-content: center; align-items: center; }
      aside ul.contact .ci .ic { width: 11px; height: 11px; }
      aside ul.skills li::before { background: ${dark ? 'var(--acc2)' : 'var(--acc)'}; }
      aside .skills .chip { background: ${dark ? 'rgba(255,255,255,.13)' : '#fff'}; color: ${ink}; }
      aside ul.langs .lvl, aside .muted { color: ${dark ? 'rgba(255,255,255,.7)' : 'var(--muted)'}; }
      aside ul.langs .dots i { background: ${dark ? 'rgba(255,255,255,.25)' : 'rgba(0,0,0,.12)'}; } aside ul.langs .dots i.on { background: ${dark ? 'var(--acc2)' : 'var(--acc)'}; }
      aside ul.certs li::marker { color: ${dark ? 'var(--acc2)' : 'var(--acc)'}; }
      ${dark ? `aside .d-ring circle:not(:first-child) { stroke: var(--acc2); } aside .d-ring circle:first-child { stroke: rgba(255,255,255,.12); }
      aside .d-mid b { color: #fff; } aside .d-mid span, aside .dv { color: rgba(255,255,255,.7); } aside ul.d-legend i { background: var(--acc2) !important; }` : ''}
      main .hd { padding-bottom: 8mm; margin-bottom: 2mm; border-bottom: 1px solid var(--rule); }
      main h1 { font-size: 30pt; }
      main h2 { color: var(--dark); } main h2 .hi { display: inline-flex; width: 26px; height: 26px; border-radius: 8px; background: var(--tint); color: var(--acc); align-items: center; justify-content: center; }
      main h2 .hi .ic { width: 14px; height: 14px; }`;
    },
  },

  /* ---------------------------------------------- 9. Coloured top + overlapping white card */
  overlap: {
    columns: 2, ats: 'good',
    html: (c) => `<div class="content"><header class="top art-host">${c.art('header')}<div class="id">${nameBlock(c)}</div>${c.s.photo}</header>
      <div class="card">${c.s.contact('inline')}${c.b.summary ? `<div class="sum">${c.s.summary}</div>` : ''}</div>
      <div class="cols"><main>${mainSecs(c, ['experience', 'projects', 'education'])}</main><aside>${sideSecs(c, ['skills', 'languages', 'certifications'], 'tags')}</aside></div></div>`,
    css: (c) => `
      .top { margin-top: calc(-1 * var(--pt)); background: ${c.v.grad ? `linear-gradient(120deg, var(--acc), ${c.v.grad})` : 'var(--dark)'}; color: #fff; padding: 16mm var(--px) 22mm; display: flex; align-items: center; gap: 20px; }
      .top .id { flex: 1; } .top h1 { color: #fff; font-size: 32pt; } .top .headline { color: rgba(255,255,255,.85); }
      .top .avatar { width: 108px; height: 108px; box-shadow: 0 0 0 4px rgba(255,255,255,.85); }
      .top .avatar.mono { background: rgba(255,255,255,.15); color: #fff; }
      .card { margin: -13mm var(--px) 0; background: #fff; border-radius: 14px; box-shadow: 0 10px 30px rgba(15,23,42,.12); padding: 14px 18px; position: relative; }
      .card .sum { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--rule); }
      .cols { display: grid; grid-template-columns: 1fr 60mm; gap: 0 9mm; padding: 0 var(--px); }
      aside section { background: var(--tint); border-radius: 12px; padding: 11px 13px; }
      h2 { color: var(--acc); } h2::before { content: ''; width: 18px; height: 3px; background: var(--acc); border-radius: 2px; }`,
  },

  /* ---------------------------------------------- 10. Geometric corners */
  geometric: {
    columns: 1, ats: 'good',
    html: (c) => `<div class="deco"><svg class="tr" viewBox="0 0 200 200"><circle cx="160" cy="40" r="110" fill="${c.pal.acc}" opacity=".95"/><circle cx="60" cy="10" r="46" fill="${c.pal.acc2}" opacity=".85"/></svg><svg class="bl" viewBox="0 0 200 200"><path d="M0 60 L140 200 L0 200 Z" fill="${c.pal.acc2}" opacity=".9"/><circle cx="20" cy="190" r="70" fill="${c.pal.acc}" opacity=".35"/></svg></div>
      <div class="content" style="padding:0 var(--px)"><header class="hd">${c.s.photo}<div class="id">${splitNameBlock(c)}${c.s.contact('inline')}</div></header>${oneColumn(c, 'tags')}</div>`,
    css: (c) => `
      .deco .tr { top: -40mm; ${c.end}: -40mm; width: 120mm; height: 120mm; ${c.rtl ? 'transform: scaleX(-1);' : ''} }
      .deco .bl { bottom: -10mm; ${c.start}: -10mm; width: 70mm; height: 70mm; ${c.rtl ? 'transform: scaleX(-1);' : ''} }
      .hd { display: flex; gap: 20px; align-items: center; padding-inline-end: 50mm; min-height: 46mm; }
      .hd .avatar { width: 112px; height: 112px; box-shadow: 0 0 0 5px var(--tint); }
      h1 { font-size: 34pt; } h1 .n1 { font-weight: 300; color: var(--ink); } h1 .n2 { color: var(--acc); }
      ul.contact.inline { margin-top: 10px; font-size: .9em; }
      h2 { color: var(--dark); } h2 .hi { display: inline-flex; width: 28px; height: 28px; border-radius: 50%; background: var(--acc); color: #fff; align-items: center; justify-content: center; }
      h2 .hi .ic { width: 14px; height: 14px; }
      h2::after { content: ''; flex: 1; height: 2px; background: var(--tint); }`,
  },

  /* ---------------------------------------------- 11. Dark page */
  dark: {
    columns: 2, ats: 'good',
    html: (c) => `<div class="content"><header class="hd art-host">${c.art('header')}${c.s.photo}<div class="id">${nameBlock(c)}${c.s.contact('inline')}</div></header>
      <div class="cols"><main>${mainSecs(c)}</main><aside>${sideSecs(c, ['skills', 'languages', 'certifications'], 'tags')}</aside></div></div>`,
    css: (c) => `
      :root { --paper: ${c.v.paper || '#0B1120'}; --ink: #CBD5E1; --dark: #F8FAFC; --muted: #94A3B8; --rule: rgba(255,255,255,.12); }
      .hd { display: flex; gap: 18px; align-items: center; padding: 0 var(--px) 9mm; border-bottom: 1px solid var(--rule); }
      .hd .avatar { width: 96px; height: 96px; box-shadow: 0 0 0 3px var(--acc); } .avatar.mono { background: rgba(255,255,255,.06); }
      h1 { font-size: 30pt; } .headline { color: var(--acc); ${c.v.mono ? "font-family: 'JetBrains Mono', monospace; font-weight: 500;" : ''} }
      ul.contact.inline { margin-top: 10px; font-size: .9em; }
      .cols { display: grid; grid-template-columns: 1fr 60mm; gap: 0 9mm; padding: 0 var(--px); }
      aside { border-inline-start: 1px solid var(--rule); padding-inline-start: 7mm; }
      h2 { color: var(--acc); ${c.v.mono && !c.rtl ? "font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: .95em;" : ''} }
      ${c.v.mono && !c.rtl ? "h2::before { content: '>'; opacity: .7; }" : ''}
      .skills .chip { background: rgba(255,255,255,.07); color: var(--dark); border: 1px solid rgba(255,255,255,.12); }
      .org { color: var(--acc); } ul.langs .dots i { background: rgba(255,255,255,.15); }`,
  },

  /* ---------------------------------------------- 12. Bento cards */
  bento: {
    columns: 2, ats: 'good',
    html: (c) => `<div class="content" style="padding:0 var(--px)"><div class="grid">
      <header class="tile hero art-host">${c.art('header')}${c.s.photo}<div class="id">${nameBlock(c)}</div></header>
      <div class="tile contact-t">${c.s.contact('stack')}</div>
      ${c.b.summary ? `<div class="tile wide">${c.sec('summary', c.h.summary, c.s.summary)}</div>` : ''}
      ${c.s.kpis.length ? `<div class="tile wide kpis">${c.s.kpis.map(([n, l]) => `<div><b>${esc(n)}</b><span>${esc(l)}</span></div>`).join('')}</div>` : ''}
      <div class="tile wide">${c.sec('experience', c.h.experience, c.s.experience)}</div>
      ${c.s.projects ? `<div class="tile wide">${c.sec('projects', c.h.projects, c.s.projects)}</div>` : ''}
      ${c.s.education ? `<div class="tile">${c.sec('education', c.h.education, c.s.education)}</div>` : ''}
      ${c.s.skills('tags') ? `<div class="tile">${c.sec('skills', c.h.skills, c.s.skills('tags'))}</div>` : ''}
      ${c.s.languages ? `<div class="tile">${c.sec('languages', c.h.languages, c.s.languages)}</div>` : ''}
      ${c.s.certifications ? `<div class="tile">${c.sec('certifications', c.h.certifications, c.s.certifications)}</div>` : ''}
      </div></div>`,
    css: () => `
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .tile { background: var(--tint); border-radius: 18px; padding: 14px 16px; break-inside: avoid; }
      .tile.wide { grid-column: 1 / -1; }
      .tile section { margin: 0; }
      .hero { background: var(--acc); color: #fff; display: flex; gap: 14px; align-items: center; }
      .hero h1 { color: #fff; font-size: 24pt; } .hero .headline { color: rgba(255,255,255,.85); }
      .hero .avatar { width: 84px; height: 84px; box-shadow: 0 0 0 3px rgba(255,255,255,.6); } .hero .avatar.mono { background: rgba(255,255,255,.18); color: #fff; font-size: 24pt; }
      .contact-t { background: var(--dark); color: #fff; display: flex; align-items: center; } .contact-t ul.contact li { margin: 4px 0; font-size: .9em; } .contact-t .ci { color: var(--acc2); }
      .kpis { display: flex; justify-content: space-around; background: #fff; border: 2px solid var(--tint); }
      .kpis div { text-align: center; } .kpis b { display: block; font-family: var(--head); font-size: 22pt; color: var(--acc); line-height: 1.1; } .kpis span { color: var(--muted); font-size: .88em; }
      .tile .skills .chip { background: #fff; }
      h2 { color: var(--acc); }`,
  },

  /* ---------------------------------------------- 13. Vertical name band */
  vertical: {
    columns: 1, ats: 'good',
    html: (c) => `<div class="deco"><div class="band">${c.art('side')}</div></div><div class="vname" aria-hidden="true">${esc(c.b.name || '')}</div>
      <div class="content" style="padding-inline: 34mm var(--px)"><header class="hd">${nameBlock(c)}${c.s.contact('inline')}</header>${oneColumn(c, 'tags')}</div>`,
    css: (c) => `
      .deco .band { overflow: hidden; top: 0; bottom: 0; ${c.start}: 0; width: 24mm; background: var(--acc); }
      .vname { position: absolute; top: var(--pt); ${c.start}: 0; width: 24mm; height: 270mm; writing-mode: vertical-rl; ${c.rtl ? '' : 'transform: rotate(180deg);'}
               display: flex; align-items: center; justify-content: flex-end; font-family: var(--head); font-weight: 800; font-size: 40pt; color: ${isDark(c.v.acc) ? '#fff' : c.v.dark};
               ${c.rtl ? '' : 'letter-spacing: .08em; text-transform: uppercase;'} white-space: nowrap; z-index: 1; opacity: .95; }
      .hd { padding-bottom: 10px; border-bottom: 3px solid var(--dark); }
      h1 { font-size: 30pt; } .headline { color: var(--acc); }
      ul.contact.inline { margin-top: 8px; font-size: .92em; }
      h2 { ${c.rtl ? '' : 'text-transform: uppercase; letter-spacing: .12em; font-size: .9em;'} }
      h2::before { content: ''; width: 12px; height: 12px; background: var(--acc); }
      @media print { .vname { position: fixed; top: 0; height: 297mm; padding: 14mm 0; } }`,
  },

  /* ---------------------------------------------- 14. Ribbon headings */
  ribbon: {
    columns: 1, ats: 'best',
    html: (c) => `<div class="content"><header class="hd art-host">${c.art('header')}${c.s.photo}<div class="id">${nameBlock(c)}${c.s.contact('inline')}</div></header><div class="body">${oneColumn(c, 'tags')}</div></div>`,
    css: (c) => `
      .hd { display: flex; gap: 18px; align-items: center; padding: 0 var(--px) 6mm; }
      .hd .avatar { width: 100px; height: 100px; border-radius: 22px; }
      h1 { font-size: 30pt; } .headline { color: var(--acc); }
      ul.contact.inline { margin-top: 8px; font-size: .92em; }
      .body { padding-inline-end: var(--px); }
      section { margin-top: 14px; } section > div { padding-inline-start: var(--px); }
      h2 { display: inline-flex; color: #fff; background: var(--acc); padding: 5px 26px 5px var(--px); padding-inline: var(--px) 26px; margin-bottom: 9px;
           clip-path: ${c.rtl ? 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 12px 50%)' : 'polygon(0 0, 100% 0, calc(100% - 12px) 50%, 100% 100%, 0 100%)'}; ${c.rtl ? '' : 'text-transform: uppercase; letter-spacing: .1em; font-size: .9em;'} }
      h2 .hi { display: inline-flex; } h2 .hi .ic { width: 13px; height: 13px; }`,
  },

  /* ---------------------------------------------- 15. Two-tone split: big name in the side panel */
  split: {
    columns: 2, ats: 'good',
    html: (c) => `<div class="deco"><div class="side">${c.art('side')}</div></div>
      <div class="content cols"><aside><div class="id">${c.s.photo}${splitNameBlock(c)}</div>${c.b.summary ? `<div class="sum">${c.s.summary}</div>` : ''}${sideSecs(c, ['contact', 'skills', 'languages'], 'tags')}</aside>
      <main>${mainSecs(c, ['experience', 'projects', 'education'])}${c.sec('certifications', c.h.certifications, c.s.certifications)}</main></div>`,
    css: (c) => {
      const ink = isDark(c.v.side) ? '#fff' : c.v.dark;
      return `
      .deco .side { overflow: hidden; top: 0; bottom: 0; ${c.start}: 0; width: 84mm; background: ${c.v.sideGrad ? `linear-gradient(160deg, ${c.v.side}, ${c.v.sideGrad})` : c.v.side}; }
      .cols { display: grid; grid-template-columns: 84mm 1fr; }
      aside { padding: 0 9mm; color: ${ink}; }
      main { padding-inline: 10mm var(--px); }
      aside .avatar { width: 96px; height: 96px; margin-bottom: 7mm; box-shadow: 0 0 0 4px var(--acc2); }
      aside .avatar.mono { background: rgba(255,255,255,.12); color: ${ink}; font-size: 28pt; }
      aside h1 { color: ${ink}; font-size: 34pt; line-height: .98; } aside h1 span { display: block; } aside h1 .n1 { font-weight: 300; } aside h1 .n2 { color: var(--acc2); }
      aside .headline { color: ${ink}; opacity: .85; margin-top: 10px; }
      aside .sum { margin-top: 8mm; padding-top: 6mm; border-top: 2px solid var(--acc2); } aside .summary { color: ${ink}; opacity: .92; }
      aside h2 { color: var(--acc2); font-size: .9em; ${c.rtl ? '' : 'letter-spacing: .14em; text-transform: uppercase;'} }
      aside ul.contact .ci { color: var(--acc2); } aside ul.contact li { margin: 5px 0; font-size: .92em; }
      aside .skills .chip { background: rgba(255,255,255,.12); color: ${ink}; }
      aside .d-ring circle:not(:first-child) { stroke: var(--acc2); } aside .d-mid b { color: ${ink}; }
      aside ul.langs .lvl { color: ${ink}; opacity: .7; } aside ul.langs .dots i { background: rgba(255,255,255,.22); } aside ul.langs .dots i.on { background: var(--acc2); }
      main section:first-child { margin-top: 0; }
      main h2 { color: var(--dark); border-bottom: 3px solid var(--acc); padding-bottom: 4px; display: inline-flex; }`;
    },
  },

  /* ---------------------------------------------- 16. Frame: luxury border, centred */
  frame: {
    columns: 1, ats: 'best',
    html: (c) => `<div class="deco"><div class="f1"></div><div class="f2"></div></div>
      <div class="content" style="padding:6mm calc(var(--px) + 8mm) 0"><header class="hd">${c.s.photo}${nameBlock(c)}${c.art('orn') || '<div class="orn">✦</div>'}${c.s.contact('inline')}</header>${oneColumn(c, 'inline')}</div>`,
    css: (c) => `
      .deco .f1 { inset: 7mm; border: 1.5px solid var(--acc); } .deco .f2 { inset: 9mm; border: .5px solid var(--acc); }
      .hd { text-align: center; } .hd .avatar { margin: 0 auto 10px; width: 90px; height: 90px; box-shadow: 0 0 0 3px var(--paper), 0 0 0 4px var(--acc); font-size: 26pt; }
      h1 { font-size: 32pt; font-weight: 500; color: var(--dark); ${c.rtl ? '' : 'letter-spacing: .12em; text-transform: uppercase;'} }
      .headline { color: var(--acc); font-weight: 500; ${c.rtl ? '' : 'letter-spacing: .2em; text-transform: uppercase; font-size: .82em;'} }
      .orn { color: var(--acc); margin: 8px 0 4px; font-size: 12pt; }
      ul.contact.inline { justify-content: center; font-size: .9em; }
      h2 { justify-content: center; color: var(--acc); font-weight: 500; ${c.rtl ? '' : 'letter-spacing: .22em; text-transform: uppercase; font-size: .86em;'} }
      h2::before, h2::after { content: ''; width: 34px; height: 1px; background: var(--acc); }
      .s-summary .summary { text-align: center; font-style: ${c.rtl ? 'normal' : 'italic'}; font-family: var(--head); font-size: 1.1em; }`,
  },

  /* ---------------------------------------------- 17. Gradient mesh + glass card */
  mesh: {
    columns: 2, ats: 'good',
    html: (c) => `<div class="content"><header class="top art-host">${c.art('header')}<div class="glass">${c.s.photo}<div class="id">${nameBlock(c)}</div></div>${c.s.contact('inline')}</header>
      <div class="cols"><main>${mainSecs(c)}</main><aside>${sideSecs(c, ['skills', 'languages', 'certifications'], 'tags')}</aside></div></div>`,
    css: (c) => `
      .top { margin-top: calc(-1 * var(--pt)); padding: 14mm var(--px) 9mm; color: #fff;
             background: radial-gradient(circle at 15% 20%, ${c.v.acc2} 0, transparent 45%), radial-gradient(circle at 85% 10%, ${c.v.grad} 0, transparent 50%), radial-gradient(circle at 60% 120%, ${c.v.acc} 0, transparent 60%), ${c.v.dark}; }
      .glass { display: flex; gap: 16px; align-items: center; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.35); border-radius: 18px; padding: 14px 18px; }
      .glass .avatar { width: 92px; height: 92px; box-shadow: 0 0 0 3px rgba(255,255,255,.7); } .glass .avatar.mono { background: rgba(255,255,255,.18); color: #fff; font-size: 26pt; }
      .top h1 { color: #fff; font-size: 30pt; } .top .headline { color: rgba(255,255,255,.9); }
      .top ul.contact.inline { margin-top: 12px; color: #fff; font-size: .9em; } .top .ci { color: #fff !important; opacity: .85; }
      .cols { display: grid; grid-template-columns: 1fr 58mm; gap: 0 9mm; padding: 0 var(--px); }
      h2 { background: linear-gradient(90deg, var(--acc), ${c.v.grad}); -webkit-background-clip: text; background-clip: text; color: transparent; font-size: 1.15em; }
      aside .skills .chip { background: var(--tint); color: var(--acc); }`,
  },

  /* ---------------------------------------------- 18. Swiss grid with numbered sections */
  swiss: {
    columns: 1, ats: 'best',
    html: (c) => `<div class="content" style="padding:0 var(--px)"><header class="hd"><div>${splitNameBlock(c)}</div>${c.s.contact('stack')}</header>${oneColumn(c, 'grid')}</div>`,
    css: (c) => `
      body { counter-reset: s; }
      .hd { display: grid; grid-template-columns: 1fr 64mm; gap: 8mm; padding-bottom: 8mm; border-bottom: 1px solid var(--dark); align-items: end; }
      h1 { font-size: 40pt; line-height: .95; ${c.rtl ? '' : 'letter-spacing: -.035em;'} } h1 span { display: block; } h1 .n2 { color: var(--acc); }
      .headline { color: var(--ink); font-weight: 500; }
      .hd ul.contact { font-size: .88em; } .hd ul.contact li { margin: 2px 0; } .hd .ci { color: var(--dark) !important; }
      section { display: grid; grid-template-columns: 40mm 1fr; gap: 0 6mm; border-top: 1px solid var(--rule); padding-top: 9px; margin-top: 12px; }
      h2 { counter-increment: s; flex-direction: column; align-items: flex-start; gap: 0; font-size: .9em; ${c.rtl ? '' : 'text-transform: uppercase; letter-spacing: .08em;'} }
      h2::before { content: counter(s, decimal-leading-zero); font-size: 2.2em; font-weight: 800; color: var(--acc); line-height: 1; letter-spacing: -.02em; }`,
  },

  /* ---------------------------------------------- 19. Marker highlight */
  marker: {
    columns: 1, ats: 'best',
    html: (c) => `<div class="content" style="padding:0 var(--px)"><header class="hd">${c.s.photo}<div class="id">${nameBlock(c)}${c.s.contact('inline')}</div></header>${oneColumn(c, 'tags')}</div>`,
    css: () => `
      .hd { display: flex; gap: 18px; align-items: center; padding-bottom: 6mm; }
      .hd .avatar { width: 96px; height: 96px; border-radius: 50% 50% 50% 14px; }
      h1 { font-size: 32pt; display: inline; background: linear-gradient(transparent 58%, var(--acc2) 58%, var(--acc2) 90%, transparent 90%); }
      .headline { color: var(--ink); margin-top: 10px; }
      ul.contact.inline { margin-top: 8px; font-size: .92em; }
      h2 span:not(.hi) { background: linear-gradient(transparent 55%, var(--acc2) 55%); padding: 0 3px; }
      .skills .chip { background: transparent; border: 1.5px dashed var(--acc); color: var(--dark); }`,
  },

  /* ---------------------------------------------- 20. Wave header */
  wave: {
    columns: 2, ats: 'good',
    html: (c) => `<div class="content"><header class="top art-host">${c.art('header')}${c.s.photo}<div class="id">${nameBlock(c)}${c.s.contact('inline')}</div>
      <svg class="w" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true"><path d="M0 60 C 200 120 400 0 600 50 C 800 100 1000 20 1200 60 L1200 120 L0 120 Z" fill="${c.pal.paper}"/><path d="M0 80 C 250 130 450 30 650 70 C 850 110 1050 40 1200 80" fill="none" stroke="${c.v.acc2}" stroke-width="5" opacity=".7"/></svg></header>
      <div class="cols"><main>${mainSecs(c)}</main><aside>${sideSecs(c, ['skills', 'languages', 'certifications'], 'tags')}</aside></div></div>`,
    css: (c) => `
      .top { position: relative; margin-top: calc(-1 * var(--pt)); padding: 14mm var(--px) 22mm; display: flex; gap: 18px; align-items: center; color: #fff;
             background: linear-gradient(135deg, var(--acc), ${c.v.grad}); }
      .top .w { position: absolute; left: 0; right: 0; bottom: -1px; width: 100%; height: 22mm; }
      .top .avatar { width: 104px; height: 104px; box-shadow: 0 0 0 4px rgba(255,255,255,.85); } .top .avatar.mono { background: rgba(255,255,255,.15); color: #fff; }
      .top h1 { color: #fff; font-size: 30pt; } .top .headline { color: rgba(255,255,255,.9); }
      .top ul.contact.inline { margin-top: 10px; font-size: .9em; } .top .ci { color: #fff !important; }
      .cols { display: grid; grid-template-columns: 1fr 60mm; gap: 0 9mm; padding: 0 var(--px); }
      aside { background: var(--tint); border-radius: 16px; padding: 4px 13px 12px; align-self: start; margin-top: 14px; }
      h2 { color: var(--acc); } h2 .hi { display: inline-flex; color: var(--acc); }`,
  },

  /* ---------------------------------------------- 22. Infographic: stat header, charts, tinted column */
  infographic: {
    columns: 2, ats: 'good',
    html: (c) => `<div class="deco"><div class="side">${c.art('side')}</div></div><div class="content">
      <header class="top art-host">${c.art('header')}${c.s.photo}<div class="id">${nameBlock(c)}</div>
      ${c.s.kpis.length ? `<div class="kp">${c.s.kpis.map(([n, l]) => `<div><b>${esc(n)}</b><span>${esc(l)}</span></div>`).join('')}</div>` : ''}</header>
      <div class="cols"><main>${mainSecs(c)}</main><aside>${sideSecs(c, ['contact', 'skills', 'languages', 'certifications'], 'tags')}</aside></div></div>`,
    css: (c) => `
      .deco .side { overflow: hidden; top: 0; bottom: 0; ${c.start}: 0; width: 70mm; background: var(--tint); }
      .top { margin-top: calc(-1 * var(--pt)); padding: 12mm var(--px) 10mm; background: var(--dark); color: #fff; display: flex; align-items: center; gap: 18px; }
      .top .id { flex: 1; min-width: 0; } .top h1 { color: #fff; font-size: 27pt; } .top .headline { color: var(--acc2); }
      .top .avatar { width: 96px; height: 96px; box-shadow: 0 0 0 4px var(--acc); } .top .avatar.mono { background: rgba(255,255,255,.08); color: #fff; font-size: 26pt; }
      .kp { display: flex; gap: 10px; }
      .kp div { width: 21mm; height: 21mm; border-radius: 50%; border: 2.5px solid var(--acc2); display: grid; place-content: center; text-align: center; line-height: 1.05; }
      .kp b { font-family: var(--head); font-size: 15pt; color: #fff; } .kp span { font-size: 6.6pt; color: rgba(255,255,255,.75); padding: 0 4px; }
      .cols { display: grid; grid-template-columns: 70mm 1fr; }
      aside { grid-column: 1; grid-row: 1; padding: 0 8mm; } main { grid-column: 2; grid-row: 1; padding-inline: 9mm var(--px); }
      aside section:first-child, main section:first-child { margin-top: 14px; }
      aside h2, main h2 { color: var(--dark); }
      h2 .hi { display: inline-flex; width: 24px; height: 24px; border-radius: 50%; background: var(--acc); color: #fff; align-items: center; justify-content: center; } h2 .hi .ic { width: 12px; height: 12px; }
      aside .skills .chip { background: #fff; }
      aside ul.contact li { margin: 6px 0; font-size: .92em; align-items: flex-start; }
      aside ul.d-legend { font-size: .84em; }
      .g-row { grid-template-columns: 26mm 1fr; }`,
  },

  /* ---------------------------------------------- 21. Compact two-column (ATS-good, dense) */
  compact: {
    columns: 1, ats: 'best',
    html: (c) => `<div class="content" style="padding:0 var(--px)"><header class="hd art-host">${c.art('header')}<div>${nameBlock(c)}</div>${c.s.contact('inline')}</header>${oneColumn(c, 'inline')}</div>`,
    css: (c) => `
      :root { --pt: 11mm; }
      body { font-size: 9.3pt; }
      .hd { display: flex; flex-direction: column; gap: 6px; padding: 10px 14px; background: var(--tint); border-inline-start: 5px solid var(--acc); }
      h1 { font-size: 22pt; } .headline { margin-top: 2px; }
      section { margin-top: 11px; } .item { margin-bottom: 7px; }
      h2 { font-size: .95em; color: var(--acc); ${c.rtl ? '' : 'text-transform: uppercase; letter-spacing: .1em;'} border-bottom: 1px solid var(--rule); padding-bottom: 3px; margin-bottom: 6px; }`,
  },
};

function nameBlockHd(c) {
  return `<header class="hd">${nameBlock(c)}</header>`;
}

/* ---------------------------------------------------------- catalogue */

/**
 * v: palette and fonts for one template.
 *   acc     the main accent        acc2  a second accent (highlights, gradients)
 *   tint    a light wash           dark  near-black for names and headings
 *   side    sidebar fill           grad  a gradient's second colour
 */
const V = (id, design, font, cat, v, names) => ({ id, design, font, cat, ...v, names });

/** Art shorthands: a pattern filling a slot, or an illustration placed in it. */
const P = (name, slot, o = {}) => ({ kind: 'pattern', name, slot, ...o });
const I = (name, slot, pos, o = {}) => ({ kind: 'ill', name, slot, pos, ...o });

const CATALOGUE = [
  // --- clean, ATS-first
  V('classic', 'classic', 'merriweather', 'professional', { acc: '#1F2937', tint: '#F3F4F6', dark: '#111827' }, ['Classic', 'كلاسيكي', 'Centred serif, small caps headings — fits any industry.', 'خط كلاسيكي في المنتصف — يناسب كل المجالات.']),
  V('harvard', 'classic', 'garamond', 'professional', { acc: '#7F1D1D', tint: '#F9F1F1', dark: '#1C1917', size: 10.8 }, ['Harvard', 'هارفارد', 'The traditional academic CV in Garamond.', 'السيرة الأكاديمية التقليدية بخط Garamond.']),
  V('modern', 'modern', 'inter', 'modern', { acc: '#1A56E8', tint: '#EAF1FF', dark: '#0F172A', art: [I('halftone', 'page', 'tr', { w: 64, h: 48, op: 0.16 })] }, ['Modern', 'عصري', 'Bold name, a thick blue rule and a halftone corner.', 'اسم بارز وخط أزرق عريض ولمسة نقاط في الركن.']),
  V('graphite', 'modern', 'archivo', 'modern', { acc: '#111827', tint: '#F3F4F6', dark: '#111827', art: [I('flow', 'page', 'top', { h: 34, op: 0.1, fit: 'none' })] }, ['Graphite', 'جرافيت', 'Heavy Archivo type in black and grey, flowing lines.', 'خط Archivo ثقيل بالأسود والرمادي وخطوط منسابة.']),
  V('executive', 'executive', 'garamond', 'executive', { acc: '#7A1F2B', tint: '#FBF2F3', dark: '#1F1A17', size: 10.8 }, ['Executive', 'تنفيذي', 'Garamond, burgundy, a diamond ornament — for senior roles.', 'خط Garamond ولون عنابي وزخرفة — للمناصب القيادية.']),
  V('minimal', 'minimal', 'worksans', 'simple', { acc: '#374151', tint: '#F3F4F6', dark: '#111827' }, ['Minimal', 'بسيط', 'Light type and lots of air.', 'خط خفيف ومساحات واسعة.']),
  V('compact', 'compact', 'inter', 'simple', { acc: '#0F766E', tint: '#ECF7F5', dark: '#0F172A', art: [P('dots', 'header', { op: 0.35, color: '#B7DCD5' })] }, ['Compact', 'مضغوط', 'Small type, tight spacing: a long career on fewer pages.', 'خط صغير ومسافات محكمة: خبرة طويلة في صفحات أقل.']),
  V('consultant', 'rail', 'inter', 'professional', { acc: '#1E3A5F', acc2: '#5B84B1', tint: '#E8EEF5', dark: '#0F172A', charts: ['gantt'], art: [I('topo', 'page', 'tr', { w: 84, h: 84, x: -22, y: -26, op: 0.13 })] }, ['Consultant', 'استشاري', 'Headings in a left rail, a career chart and contour lines.', 'عناوين في عمود جانبي ورسم بياني للمسار وخطوط تضاريس.']),
  V('nordic', 'rail', 'raleway', 'simple', { acc: '#4B6584', acc2: '#9DB3CC', tint: '#EDF1F5', dark: '#1E293B', art: [I('mountains', 'page', 'bottom', { h: 26, op: 0.16, fit: 'none' })] }, ['Nordic', 'نوردك', 'Airy left-rail layout with quiet hills at the foot.', 'تخطيط هادئ بعمود عناوين وتلال في أسفل الصفحة.']),
  V('swiss', 'swiss', 'inter', 'modern', { acc: '#E11D48', tint: '#FFF1F3', dark: '#0A0A0A', art: [P('grid', 'page', { color: '#F1F1F1' })] }, ['Swiss', 'سويسري', 'Numbered sections on a visible grid, black and red.', 'أقسام مرقّمة على شبكة ظاهرة بالأسود والأحمر.']),
  V('cobalt', 'swiss', 'space', 'modern', { acc: '#2547F4', acc2: '#8EA2FA', tint: '#EEF1FE', dark: '#0B1020', art: [I('orbit', 'page', 'tr', { w: 70, h: 70, x: -22, y: -22, op: 0.16 })] }, ['Cobalt', 'كوبالت', 'Swiss grid, Space Grotesk and orbit lines.', 'شبكة سويسرية بخط Space Grotesk ومدارات.']),
  // --- timeline
  V('tech', 'chrono', 'space', 'modern', { acc: '#0F766E', acc2: '#5EC4B6', tint: '#DDF3EF', dark: '#0F172A', charts: ['gantt'], art: [I('orbit', 'page', 'tr', { w: 66, h: 66, x: -20, y: -20, op: 0.22 })] }, ['Tech', 'تقني', 'Teal timeline, a career chart and orbit rings.', 'خط زمني فيروزي ورسم بياني للمسار ومدارات.']),
  V('pathway', 'chrono', 'outfit', 'modern', { acc: '#2563EB', acc2: '#93B4F8', tint: '#E3ECFE', dark: '#0F172A', charts: ['kpis'], art: [I('flow', 'page', 'top', { h: 44, op: 0.22, fit: 'none' })] }, ['Pathway', 'المسار', 'Key numbers up top and a blue timeline.', 'أرقامك البارزة في الأعلى وخط زمني أزرق.']),
  V('chronicle', 'chrono', 'fraunces', 'executive', { acc: '#9A3412', acc2: '#E6A57E', tint: '#FBEDE3', dark: '#1C1917', art: [I('leaves', 'page', 'br', { w: 42, h: 52, x: 6, y: 4, op: 0.3, flip: 'x' })] }, ['Chronicle', 'السجلّ', 'Fraunces serif on a rust timeline, a leafy sprig.', 'خط Fraunces على خط زمني بلون الصدأ وغصن أوراق.']),
  // --- editorial
  V('editorial', 'editorial', 'archivo', 'creative', { acc: '#DC2626', tint: '#FEF2F2', dark: '#0A0A0A', art: [I('halftone', 'header', 'tr', { w: 60, h: 45, op: 0.22, color: 'acc' })] }, ['Editorial', 'مجلة', 'A magazine cover: huge stacked name, halftone print.', 'كغلاف مجلة: اسم ضخم ونقاط طباعة.']),
  V('gazette', 'editorial', 'playfair', 'executive', { acc: '#1E3A8A', tint: '#EEF2FB', dark: '#0B1220' }, ['Gazette', 'جازيت', 'Newspaper serif, navy, two columns.', 'خط صحفي كلاسيكي وكحلي بعمودين.']),
  // --- sidebar
  V('emerald', 'sidebar', 'nunito', 'modern', { acc: '#059669', acc2: '#6EE7B7', tint: '#E7F7F0', dark: '#064E3B', side: '#064E3B', sideSkills: 'tags', langBars: true, charts: ['donut'], art: [I('leaves', 'side', 'bl', { w: 66, h: 80, x: -4, y: -6, op: 0.22, color: 'acc2', color2: 'acc2' })] }, ['Emerald', 'زمرّدي', 'Deep green sidebar with leaves, a career donut and level bars.', 'عمود أخضر بأوراق نباتية ورسم دائري للخبرة وأشرطة مستوى.']),
  V('slate', 'sidebar', 'montserrat', 'professional', { acc: '#475569', acc2: '#CBD5E1', tint: '#EEF2F6', dark: '#0F172A', side: '#1E293B', langBars: true, charts: ['gantt'], art: [P('diag', 'side', { color: '#ffffff', op: 0.05 })] }, ['Slate', 'أردوازي', 'Slate sidebar, photo and a career timeline chart.', 'عمود رمادي داكن مع صورة ورسم بياني للمسار.']),
  V('navy', 'sidebar', 'merriweather', 'executive', { acc: '#B08D57', acc2: '#D9B98A', tint: '#F7F1E8', dark: '#14213D', side: '#14213D', art: [P('arabesque', 'side', { color: 'acc2', op: 0.2 })] }, ['Navy & Gold', 'كحلي وذهبي', 'Navy column with a gold geometric star pattern.', 'عمود كحلي بنقش نجمي إسلامي ذهبي.']),
  V('blush', 'sidebar', 'dmserif', 'creative', { acc: '#BE5A72', acc2: '#BE5A72', tint: '#FBEFF2', dark: '#4A1D2A', side: '#F6E3E8', sideSkills: 'tags', art: [I('blobs', 'side', 'bl', { w: 64, h: 64, x: -12, y: -14, op: 0.2 }), I('sparkles', 'page', 'tr', { w: 30, h: 26, x: 10, y: 10, op: 0.55 })] }, ['Blush', 'وردي', 'Blush column with soft shapes and sparkles.', 'عمود وردي بأشكال ناعمة ولمعات.']),
  V('sand', 'sidebar', 'lora', 'professional', { acc: '#8B5E34', acc2: '#8B5E34', tint: '#F6EEE4', dark: '#3E2A1A', side: '#EDE0CF', charts: ['donut'], art: [I('leaves', 'side', 'bl', { w: 66, h: 80, x: -4, y: -6, op: 0.3 })] }, ['Sand', 'رملي', 'Beige column with a line-drawn branch and a career donut.', 'عمود بيج بغصن مرسوم ورسم دائري للخبرة.']),
  V('royal', 'sidebar', 'poppins', 'creative', { acc: '#7C3AED', acc2: '#C4B5FD', tint: '#F3EEFE', dark: '#2E1065', side: '#4C1D95', sideGrad: '#7C3AED', sideSkills: 'tags', langBars: true, art: [P('dots', 'side', { color: '#ffffff', op: 0.1 }), I('orbit', 'side', 'bl', { w: 80, h: 80, x: -26, y: -26, op: 0.2, color: 'white', color2: 'acc2' })] }, ['Royal', 'ملكي', 'Purple gradient sidebar with dots and orbits.', 'عمود بنفسجي متدرج بنقاط ومدارات.']),
  V('sky', 'sidebar', 'poppins', 'modern', { acc: '#0284C7', acc2: '#0284C7', tint: '#E6F3FB', dark: '#0C4A6E', side: '#DCEFFB', sideSkills: 'tags', langBars: true, charts: ['donut'], art: [I('blobs', 'side', 'tr', { w: 56, h: 56, x: -16, y: -16, op: 0.5, color: 'white', color2: 'acc' })] }, ['Sky', 'سماء', 'Light blue column, soft shapes, a donut chart and level bars.', 'عمود أزرق فاتح بأشكال ناعمة ورسم دائري وأشرطة مستوى.']),
  // --- overlap card
  V('bold', 'overlap', 'montserrat', 'modern', { acc: '#334155', acc2: '#94A3B8', tint: '#F1F5F9', dark: '#0F172A', charts: ['gantt'], art: [P('diag', 'header', { color: '#ffffff', op: 0.07 })] }, ['Bold', 'جريء', 'Dark striped top, a floating card and a career chart.', 'رأس داكن مخطط وبطاقة عائمة ورسم بياني للمسار.']),
  V('azure', 'overlap', 'outfit', 'modern', { acc: '#1D4ED8', acc2: '#06B6D4', tint: '#EAF0FE', dark: '#0F172A', grad: '#06B6D4', charts: ['kpis'], art: [I('flow', 'header', 'full', { op: 0.3, color: 'white', fit: 'none' })] }, ['Azure', 'لازوردي', 'Blue-cyan gradient with flowing lines and key numbers.', 'رأس أزرق متدرج بخطوط منسابة وأرقام بارزة.']),
  V('coral', 'overlap', 'poppins', 'creative', { acc: '#F43F5E', acc2: '#FB923C', tint: '#FFEEF1', dark: '#1F2937', grad: '#FB923C', art: [P('memphis', 'header', { color: '#ffffff', color2: '#ffffff', color3: '#ffffff', op: 0.3 })] }, ['Coral', 'مرجاني', 'Coral-to-peach top with playful Memphis shapes.', 'رأس مرجاني بأشكال ممفيس مرحة.']),
  V('mashrabiya', 'overlap', 'merriweather', 'executive', { acc: '#C9A227', acc2: '#E5C76B', tint: '#F6F1E1', dark: '#0B3D2E', art: [P('arabesque', 'header', { color: 'acc', op: 0.28 })] }, ['Mashrabiya', 'مشربية', 'Deep green header with a gold Islamic star lattice.', 'رأس أخضر داكن بنقش مشربية إسلامي ذهبي.']),
  // --- geometric
  V('creative', 'geometric', 'poppins', 'creative', { acc: '#7C3AED', acc2: '#F472B6', tint: '#F3EEFE', dark: '#1E1B4B', charts: ['kpis'], kpiStyle: 'rings', art: [I('sparkles', 'page', 'bl', { w: 34, h: 30, x: 50, y: 10, op: 0.6 })] }, ['Creative', 'إبداعي', 'Violet and pink shapes, sparkles and ringed numbers.', 'أشكال بنفسجية ووردية ولمعات وأرقام في دوائر.']),
  V('sunrise', 'geometric', 'outfit', 'creative', { acc: '#F97316', acc2: '#FACC15', tint: '#FFF4E8', dark: '#1C1917', charts: ['kpis'], kpiStyle: 'rings', art: [I('halftone', 'page', 'bl', { w: 56, h: 42, x: 54, y: 0, op: 0.2, flip: 'x' })] }, ['Sunrise', 'شروق', 'Orange and yellow circles with halftone dots.', 'دوائر برتقالية وصفراء ونقاط طباعة.']),
  V('lagoon', 'geometric', 'nunito', 'creative', { acc: '#0D9488', acc2: '#38BDF8', tint: '#E6F7F5', dark: '#0F2E2B', art: [I('topo', 'page', 'bl', { w: 76, h: 76, x: 30, y: -20, op: 0.16 })] }, ['Lagoon', 'بحيرة', 'Teal and sky shapes over contour lines.', 'أشكال فيروزية وسماوية فوق خطوط تضاريس.']),
  // --- dark
  V('midnight', 'dark', 'space', 'modern', { acc: '#22D3EE', acc2: '#0E7490', tint: '#0E2230', paper: '#0B1120', mono: true, charts: ['gantt'], art: [P('grid', 'page', { color: '#22D3EE', op: 0.05 })] }, ['Midnight', 'منتصف الليل', 'A dark grid page, cyan code accents and a career chart.', 'صفحة داكنة بشبكة ولمسات برمجية ورسم بياني.']),
  V('blueprint', 'dark', 'space', 'modern', { acc: '#7DD3FC', acc2: '#38BDF8', tint: '#123B66', paper: '#0B2545', mono: true, charts: ['gantt'], art: [P('blueprint', 'page', { color: '#7DD3FC', op: 0.12 })] }, ['Blueprint', 'مخطط هندسي', 'An engineering blueprint: drafting grid on deep blue.', 'كمخطط هندسي: شبكة رسم على أزرق داكن.']),
  V('noir', 'dark', 'cormorant', 'executive', { acc: '#D4AF37', acc2: '#8C7322', tint: '#1E1A12', paper: '#111111', art: [I('rays', 'page', 'tr', { w: 90, h: 90, op: 0.1 })] }, ['Noir', 'نوار', 'Black page, gold serif and Art Deco rays.', 'صفحة سوداء وخط ذهبي وأشعة آرت ديكو.']),
  // --- bento
  V('bento', 'bento', 'outfit', 'creative', { acc: '#4F46E5', acc2: '#A5B4FC', tint: '#EEF0FE', dark: '#1E1B4B', art: [P('dots', 'header', { color: '#ffffff', op: 0.18 })] }, ['Bento', 'بينتو', 'Rounded tiles and key numbers at a glance.', 'بطاقات دائرية الحواف وأرقام بارزة.']),
  V('pastel', 'bento', 'nunito', 'creative', { acc: '#DB2777', acc2: '#FBCFE8', tint: '#FDF0F6', dark: '#3B0A24', art: [P('terrazzo', 'header', { color: '#ffffff', color2: 'acc2', color3: '#F9A8D4', op: 0.35 })] }, ['Pastel', 'باستيل', 'Soft pink tiles and a terrazzo hero.', 'بطاقات وردية ناعمة ورأس بنقش تيرازو.']),
  // --- vertical name
  V('vertical', 'vertical', 'bebas', 'creative', { acc: '#FACC15', tint: '#FEF9C3', dark: '#111827', art: [P('chevron', 'side', { color: '#111827', op: 0.1 })] }, ['Vertical', 'رأسي', 'Your name runs down a yellow chevron band.', 'اسمك مكتوب رأسيًا على شريط أصفر.']),
  V('ink', 'vertical', 'syne', 'creative', { acc: '#111827', tint: '#F3F4F6', dark: '#111827', art: [P('waves', 'side', { color: '#ffffff', op: 0.14 })] }, ['Ink', 'حبر', 'Black wave band with your name in white.', 'شريط أسود بأمواج واسمك بالأبيض.']),
  // --- ribbon
  V('ribbon', 'ribbon', 'montserrat', 'modern', { acc: '#DC2626', tint: '#FEF2F2', dark: '#111827', art: [I('halftone', 'page', 'tr', { w: 60, h: 45, op: 0.18 })] }, ['Ribbon', 'شريط', 'Red ribbon headings and a halftone corner.', 'عناوين على شرائط حمراء ونقاط في الركن.']),
  V('forest', 'ribbon', 'raleway', 'professional', { acc: '#166534', acc2: '#86C79A', tint: '#ECF7EF', dark: '#052E16', art: [I('mountains', 'page', 'bottom', { h: 24, op: 0.14, fit: 'none' })] }, ['Forest', 'غابة', 'Green ribbons and hills at the foot of the page.', 'شرائط خضراء وتلال أسفل الصفحة.']),
  V('brush', 'ribbon', 'dmserif', 'creative', { acc: '#E11D48', acc2: '#FECDD3', tint: '#FFF1F3', dark: '#1F1F1F', art: [I('brush', 'name', 'full', { color: 'acc2', fit: 'none', mirror: false })] }, ['Brush', 'فرشاة', 'Your name on a painted brush stroke.', 'اسمك على ضربة فرشاة مرسومة.']),
  // --- two-tone split
  V('charcoal', 'split', 'bebas', 'creative', { acc: '#18181B', acc2: '#FACC15', tint: '#F4F4F5', dark: '#18181B', side: '#18181B', art: [P('diag', 'side', { color: 'acc2', op: 0.08 })] }, ['Charcoal', 'فحمي', 'Big name in a striped black panel, yellow highlights.', 'اسم كبير في لوحة سوداء مخططة ولمسات صفراء.']),
  V('aurora', 'split', 'syne', 'creative', { acc: '#6366F1', acc2: '#F0ABFC', tint: '#EEF0FE', dark: '#1E1B4B', side: '#312E81', sideGrad: '#7C3AED', langBars: true, charts: ['gantt'], art: [P('dots', 'side', { color: '#ffffff', op: 0.08 }), I('orbit', 'side', 'bl', { w: 92, h: 92, x: -28, y: -28, op: 0.2, color: 'white', color2: 'acc2' })] }, ['Aurora', 'شفق', 'Indigo-violet panel with orbits and a career chart.', 'لوحة نيلية بنفسجية بمدارات ورسم بياني للمسار.']),
  V('terracotta', 'split', 'fraunces', 'creative', { acc: '#B4532A', acc2: '#F6C9A8', tint: '#FBEFE8', dark: '#3B1D10', side: '#7C2D12', art: [I('leaves', 'side', 'bl', { w: 80, h: 96, x: -6, y: -8, op: 0.25, color: 'acc2', color2: 'acc2' })] }, ['Terracotta', 'تيراكوتا', 'Warm clay panel with a drawn branch.', 'لوحة بلون الطين الدافئ وغصن مرسوم.']),
  // --- frame
  V('elegant', 'frame', 'cormorant', 'executive', { acc: '#A07D3B', tint: '#FAF5EC', dark: '#1F1A14', size: 10.4, art: [I('laurel', 'orn', 'inline', { w: 64, h: 18 })] }, ['Elegant', 'أنيق', 'A thin gold frame and a laurel under your name.', 'إطار ذهبي رفيع وإكليل غار تحت اسمك.']),
  V('botanical', 'frame', 'cormorant', 'executive', { acc: '#5B7F4A', acc2: '#B5CDA3', tint: '#F2F6EE', dark: '#1F2A1B', size: 10.4, art: [I('leaves', 'page', 'bl', { w: 34, h: 42, x: 3, y: 3, op: 0.5 }), I('leaves', 'page', 'tr', { w: 46, h: 56, x: 4, y: 4, op: 0.6, rot: 180, mirror: false })] }, ['Botanical', 'نباتي', 'Hand-drawn leaves in the corners of a framed page.', 'أوراق مرسومة باليد في أركان صفحة بإطار.']),
  V('pearl', 'frame', 'playfair', 'executive', { acc: '#64748B', acc2: '#A3B1C2', tint: '#F1F5F9', dark: '#0F172A', art: [I('sparkles', 'page', 'tr', { w: 30, h: 26, x: 14, y: 14, op: 0.5 })] }, ['Pearl', 'لؤلؤي', 'Silver frame, Playfair and a few sparkles.', 'إطار فضي وخط Playfair ولمعات.']),
  // --- mesh
  V('mesh', 'mesh', 'outfit', 'modern', { acc: '#6366F1', acc2: '#EC4899', grad: '#06B6D4', tint: '#EEF0FE', dark: '#0F172A', charts: ['kpis'], art: [P('dots', 'header', { color: '#ffffff', op: 0.16 })] }, ['Mesh', 'تدرّج', 'Colour-mesh header, glass card and key numbers.', 'رأس بتدرج ألوان وبطاقة زجاجية وأرقام بارزة.']),
  V('citrus', 'mesh', 'poppins', 'creative', { acc: '#16A34A', acc2: '#FACC15', grad: '#22D3EE', tint: '#ECFAF0', dark: '#052E16', art: [I('blobs', 'header', 'tr', { w: 70, h: 70, x: -12, y: -20, op: 0.28, color: 'white', color2: 'acc2' })] }, ['Citrus', 'حمضيات', 'Lime, lemon and aqua mesh with organic shapes.', 'رأس بتدرج ليموني ومائي وأشكال عضوية.']),
  // --- marker
  V('marker', 'marker', 'poppins', 'creative', { acc: '#CA8A04', acc2: '#FDE68A', tint: '#FEF9E7', dark: '#1C1917', art: [I('sparkles', 'page', 'tr', { w: 36, h: 30, x: 12, y: 10, op: 0.8 })] }, ['Marker', 'ماركر', 'Highlighter-pen headings and sparkles, playful but tidy.', 'عناوين كأنها مظللة بقلم ولمعات — مرح ومرتب.']),
  V('mint', 'marker', 'nunito', 'simple', { acc: '#0D9488', acc2: '#99F6E4', tint: '#EAFBF7', dark: '#0F2E2B', art: [I('blobs', 'page', 'tr', { w: 62, h: 62, x: -16, y: -18, op: 0.22 })] }, ['Mint', 'نعناعي', 'Mint highlights and a soft corner shape.', 'لمسات نعناعية وشكل ناعم في الركن.']),
  // --- wave
  V('wave', 'wave', 'outfit', 'modern', { acc: '#2563EB', acc2: '#93C5FD', grad: '#7C3AED', tint: '#EEF3FE', dark: '#0F172A', art: [P('dots', 'header', { color: '#ffffff', op: 0.14 })] }, ['Wave', 'موجة', 'Gradient header with a wave edge.', 'رأس متدرج بحافة موجية.']),
  V('rose', 'wave', 'dmserif', 'creative', { acc: '#BE185D', acc2: '#FBCFE8', grad: '#F97316', tint: '#FDF0F6', dark: '#3B0A24', art: [I('leaves', 'header', 'tr', { w: 44, h: 54, x: 8, y: -4, op: 0.35, color: 'white', color2: 'white', rot: 180, mirror: false })] }, ['Rose', 'وردة', 'Rose-to-amber wave with drawn leaves.', 'موجة وردية متدرجة وأوراق مرسومة.']),
  // --- rule + art
  V('atlas', 'modern', 'worksans', 'professional', { acc: '#0E7490', acc2: '#67B7C9', tint: '#E6F4F7', dark: '#0F172A', charts: ['gantt'], art: [I('topo', 'page', 'tr', { w: 92, h: 92, x: -22, y: -26, op: 0.18 })] }, ['Atlas', 'أطلس', 'Map contour lines and a career timeline chart.', 'خطوط خرائط ورسم بياني للمسار المهني.']),
  // --- infographic
  V('infographic', 'infographic', 'outfit', 'modern', { acc: '#0EA5E9', acc2: '#7DD3FC', tint: '#EEF6FB', dark: '#0F172A', langBars: true, charts: ['gantt', 'donut'], art: [P('blueprint', 'header', { color: '#ffffff', op: 0.06 })] }, ['Infographic', 'إنفوجرافيك', 'Stat circles, a career timeline, a donut and level bars.', 'دوائر أرقام وخط زمني للمسار ورسم دائري وأشرطة مستوى.']),
  V('metrics', 'infographic', 'montserrat', 'professional', { acc: '#10B981', acc2: '#6EE7B7', tint: '#ECFDF5', dark: '#064E3B', langBars: true, charts: ['gantt', 'donut'], art: [I('halftone', 'header', 'tr', { w: 64, h: 48, op: 0.16, color: 'white' })] }, ['Metrics', 'مقاييس', 'Green infographic: your career in charts.', 'إنفوجرافيك أخضر: مسارك في رسوم بيانية.']),
  V('spectrum', 'infographic', 'poppins', 'creative', { acc: '#F59E0B', acc2: '#FCD34D', tint: '#FEF6E7', dark: '#1F2937', langBars: true, charts: ['gantt', 'donut'], art: [P('hex', 'header', { color: 'acc2', op: 0.12 })] }, ['Spectrum', 'طيف', 'Amber infographic on a hexagon header.', 'إنفوجرافيك كهرماني برأس سداسي النقش.']),
];

const BY_ID = Object.fromEntries(CATALOGUE.map((t) => [t.id, t]));
export const TEMPLATES = CATALOGUE.map((t) => t.id);

const CATEGORY = {
  professional: ['Professional', 'احترافي'], modern: ['Modern', 'عصري'], creative: ['Creative', 'إبداعي'],
  executive: ['Executive', 'فاخر'], simple: ['Simple', 'بسيط'],
};

/** Names, a one-line pitch and gallery facts per template, for the app and the site. */
export const TEMPLATE_META = Object.fromEntries(CATALOGUE.map((t) => {
  const d = DESIGNS[t.design];
  const [nameEn, nameAr, descEn, descAr] = t.names;
  return [t.id, {
    nameEn, nameAr, descEn, descAr, design: t.design,
    accent: t.acc, fill: t.side || t.dark || t.acc, columns: d.columns, ats: d.ats,
    photo: ['sidebar', 'overlap', 'geometric', 'dark', 'bento', 'ribbon', 'split', 'frame', 'mesh', 'marker', 'wave', 'infographic'].includes(t.design),
    category: t.cat, categoryEn: CATEGORY[t.cat][0], categoryAr: CATEGORY[t.cat][1],
  }];
}));

/* ------------------------------------------------------------- render */

function fontLink(v, rtl) {
  const f = FONTS[v.font] || FONTS.inter;
  const families = rtl ? [AR_GF[f.ar]] : [...f.gf];
  if (!rtl && (v.mono || v.design === 'dark') && !families.some((x) => x.startsWith('JetBrains'))) families.push('JetBrains+Mono:wght@400;500');
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${families.map((x) => `family=${x}`).join('&')}&display=swap">`;
}

/**
 * @param {object} cvInput
 * @param {{ template?: string, lang?: string, title?: string, toolbar?: boolean, autoPrint?: boolean }} [opts]
 */
export function renderCvHtml(cvInput, opts = {}) {
  const cv = sanitizeCv(cvInput);
  const lang = HEADINGS[opts.lang] ? opts.lang : 'en';
  const h = HEADINGS[lang];
  const v = BY_ID[opts.template] || BY_ID.classic;
  const design = DESIGNS[v.design];
  const rtl = lang === 'ar';
  const b = cv.basics;
  const s = blocks(cv, h, lang, v);
  const sec = (cls, title, body) => (body
    ? `<section class="s-${cls}"><h2><span class="hi">${icon(cls)}</span><span>${esc(title)}</span></h2><div class="sb">${body}</div></section>`
    : '');
  const pal = { acc: v.acc, acc2: v.acc2 || v.acc, dark: v.dark || '#111827', tint: v.tint, paper: v.paper || '#fff', side: v.side || v.dark, white: '#fff', black: '#000' };
  const art = (slot) => renderArt(v.art, slot, pal, rtl);
  const ctx = { v, s, h, b, cv, pal, art, rtl, sec, start: rtl ? 'right' : 'left', end: rtl ? 'left' : 'right' };
  const pageArt = art('page');

  const title = esc(opts.title || [b.name, b.headline].filter(Boolean).join(' — ') || 'CV');
  return `<!doctype html>
<html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
${fontLink(v, rtl)}
<style>${baseCss(v, rtl)}
${design.css(ctx)}
  @media screen and (max-width: 820px) {
    .content[style] { padding-inline: var(--px) !important; padding-top: 0 !important; }
    .hd, .top, .kp, .glass { flex-wrap: wrap; }
    .hd { grid-template-columns: minmax(0, 1fr) !important; }
    .d-rail section, .d-swiss section { display: block; }
    .d-rail section > div { border: 0; padding: 0; }
    .d-bento .grid { grid-template-columns: minmax(0, 1fr); }
    .vname, .art { display: none; }
    h1 { font-size: 26pt !important; overflow-wrap: anywhere; }
    .top, .d-split aside, .d-sidebar aside { margin-top: 0; }
    .d-split aside, .d-sidebar aside { background: ${pal.side}; color: ${isDark(pal.side) ? '#fff' : pal.dark}; padding-block: 18px !important; }
    .d-infographic aside { background: var(--tint); padding-block: 4px 14px !important; }
    .d-vertical .content, .d-geometric .hd { padding-inline: var(--px) !important; }
    .g-row { grid-template-columns: 22mm minmax(0, 1fr); }
  }</style>
</head>
<body>
${opts.toolbar === false ? '' : `<div class="toolbar"><button type="button" onclick="window.print()">${esc(h.print)}</button><span>${esc(h.hint)}</span></div>`}
<div class="page d-${v.design} t-${v.id}${v.langBars ? ' lang-bars' : ''}">${pageArt ? `<div class="deco">${pageArt}</div>` : ''}${design.html(ctx)}</div>
${opts.autoPrint ? '<script>window.addEventListener("load",function(){document.fonts&&document.fonts.ready?document.fonts.ready.then(function(){setTimeout(function(){window.print()},300)}):setTimeout(function(){window.print()},800)})</script>' : ''}
</body>
</html>`;
}

/** A cover letter as a printable page in the same visual family as the CV. */
export function renderLetterHtml({ letter, cv, lang = 'en', template = 'classic' }) {
  const c = sanitizeCv(cv || {});
  const v = BY_ID[template] || BY_ID.classic;
  const rtl = lang === 'ar';
  const h = HEADINGS[lang] || HEADINGS.en;
  const f = FONTS[v.font] || FONTS.inter;
  const head = rtl ? f.ar : f.head;
  const body = rtl ? f.ar : f.body;
  const dark = v.design === 'dark';
  const fill = v.side || (v.grad ? `linear-gradient(120deg, ${v.acc}, ${v.grad})` : v.dark || v.acc);
  const paras = String(letter || '').split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const contact = contactItems(c.basics).map(([k, val]) => `<li>${icon(k)}<span>${esc(val)}</span></li>`).join('');
  return `<!doctype html>
<html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(c.basics.name || 'Cover letter')}</title>
${fontLink(v, rtl)}
<style>
 @page { size: A4; margin: 0; } * { box-sizing: border-box; }
 html { background:#dde1e7; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
 body { margin:0; font-family:${stack(body)}; font-size:11pt; line-height:${rtl ? 1.75 : 1.6}; color:${dark ? '#CBD5E1' : '#1F2937'} }
 .page { background:${dark ? v.paper : '#fff'}; width:210mm; min-height:297mm; margin:16px auto; box-shadow:0 2px 16px rgba(0,0,0,.12) }
 .hd { padding: 16mm 20mm 11mm; background:${fill}; color:#fff; }
 h1 { margin:0; font-family:${stack(head)}; font-size:24pt; color:#fff }
 .hl { margin-top:4px; font-weight:600; opacity:.9 }
 ul { list-style:none; margin:10px 0 0; padding:0; display:flex; flex-wrap:wrap; gap:4px 16px; font-size:.92em }
 li { display:flex; align-items:center; gap:6px } .ic { width:1em; height:1em }
 .bd { padding: 14mm 20mm 20mm } p { margin:0 0 12px }
 .toolbar { position:sticky; top:0; display:flex; gap:12px; justify-content:center; align-items:center; padding:10px; background:#0f172a; color:#e2e8f0; font:14px system-ui; flex-wrap:wrap }
 .toolbar button { background:#1A56E8; color:#fff; border:0; border-radius:8px; padding:9px 16px; font:600 14px system-ui; cursor:pointer }
 @media print { html{background:#fff} .toolbar{display:none} .page{margin:0; width:auto; min-height:0; box-shadow:none} }
 @media screen and (max-width:820px){ .page{width:auto; margin:0; min-height:0} .hd,.bd{padding:18px} }
</style></head><body>
<div class="toolbar"><button type="button" onclick="window.print()">${esc(h.print)}</button><span>${esc(h.hint)}</span></div>
<div class="page"><header class="hd"><h1>${esc(c.basics.name)}</h1>${c.basics.headline ? `<div class="hl">${esc(c.basics.headline)}</div>` : ''}${contact ? `<ul>${contact}</ul>` : ''}</header><div class="bd">${paras}</div></div>
</body></html>`;
}
