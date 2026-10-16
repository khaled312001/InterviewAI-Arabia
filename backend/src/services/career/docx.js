/**
 * CV → .docx, with no dependency.
 *
 * Many employers' application forms and older ATS still ask for Word, and a
 * .docx is the format recruiters edit before forwarding. A .docx is a zip of a
 * few XML files; the zip writer below (store + deflate, CRC-32) is the whole of
 * what that needs, which is less code and less risk on this host than adding a
 * library with native or transitive baggage.
 *
 * Layout mirrors the HTML templates: one column, real headings, bullets as
 * paragraphs with a hanging indent. Arabic paragraphs carry <w:bidi/> so Word
 * lays them out right-to-left.
 */

import zlib from 'node:zlib';
import { sanitizeCv } from './cv.js';

/* ---------------------------------------------------------------- zip */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

  for (const { name, data } of files) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const deflated = zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, deflated);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(dosTime, 12);
    cen.writeUInt16LE(dosDate, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(deflated.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);

    offset += local.length + nameBuf.length + deflated.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuf, end]);
}

/* ---------------------------------------------------------- wordml */

const x = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // Characters XML 1.0 forbids would make Word refuse the whole file.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const LABELS = {
  en: ['Summary', 'Experience', 'Education', 'Skills', 'Projects', 'Certifications', 'Languages', 'Present'],
  ar: ['الملخص المهني', 'الخبرات العملية', 'التعليم', 'المهارات', 'المشاريع', 'الشهادات', 'اللغات', 'حتى الآن'],
  de: ['Profil', 'Berufserfahrung', 'Ausbildung', 'Kenntnisse', 'Projekte', 'Zertifikate', 'Sprachen', 'heute'],
  fr: ['Profil', 'Expérience professionnelle', 'Formation', 'Compétences', 'Projets', 'Certifications', 'Langues', 'présent'],
  es: ['Perfil', 'Experiencia', 'Formación', 'Habilidades', 'Proyectos', 'Certificaciones', 'Idiomas', 'actualidad'],
};

export function renderCvDocx(cvInput, { lang = 'en' } = {}) {
  const cv = sanitizeCv(cvInput);
  const L = LABELS[lang] || LABELS.en;
  const rtl = lang === 'ar';
  const font = rtl ? 'Arial' : 'Calibri';
  const pPr = (extra = '') => `<w:pPr>${rtl ? '<w:bidi/>' : ''}${extra}</w:pPr>`;
  const run = (text, { bold = false, size = 21, color = '111827', italic = false } = {}) =>
    `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>${bold ? '<w:b/><w:bCs/>' : ''}${italic ? '<w:i/>' : ''}<w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>${rtl ? '<w:rtl/>' : ''}</w:rPr><w:t xml:space="preserve">${x(text)}</w:t></w:r>`;
  const para = (runs, extra = '') => `<w:p>${pPr(extra)}${runs}</w:p>`;
  const heading = (text) => para(run(rtl ? text : text.toUpperCase(), { bold: true, size: 22, color: '1A56E8' }),
    '<w:spacing w:before="200" w:after="60"/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="1A56E8"/></w:pBdr>');
  const bullet = (text) => para(run(`•  ${text}`), '<w:spacing w:after="20"/><w:ind w:left="360" w:hanging="220"/>');
  const fmt = (d) => (d ? d.split('-').reverse().join('/') : '');
  const span = (s, e, cur) => [fmt(s), cur ? L[7] : fmt(e)].filter(Boolean).join(' – ');

  const b = cv.basics;
  const body = [];
  body.push(para(run(b.name, { bold: true, size: 40 }), '<w:spacing w:after="40"/>'));
  if (b.headline) body.push(para(run(b.headline, { bold: true, size: 24, color: '374151' })));
  const contact = [b.location, b.phone, b.email, ...b.links.map((l) => l.url)].filter(Boolean).join('  ·  ');
  if (contact) body.push(para(run(contact, { size: 19, color: '374151' }), '<w:spacing w:after="120"/>'));

  if (b.summary) { body.push(heading(L[0])); body.push(para(run(b.summary))); }
  if (cv.experience.length) {
    body.push(heading(L[1]));
    for (const e of cv.experience) {
      body.push(para(
        run(e.title, { bold: true }) + (e.company ? run(`, ${e.company}`) : '') + (e.location ? run(` · ${e.location}`, { color: '4B5563' }) : ''),
        '<w:spacing w:before="80" w:after="0"/>',
      ));
      const when = span(e.start, e.end, e.current);
      if (when) body.push(para(run(when, { size: 19, color: '4B5563', italic: true })));
      e.bullets.forEach((t) => body.push(bullet(t)));
    }
  }
  if (cv.education.length) {
    body.push(heading(L[2]));
    for (const e of cv.education) {
      body.push(para(run([e.degree, e.field].filter(Boolean).join(', '), { bold: true }) + (e.school ? run(`, ${e.school}`) : ''), '<w:spacing w:before="80" w:after="0"/>'));
      const when = span(e.start, e.end, false);
      if (when) body.push(para(run(when, { size: 19, color: '4B5563', italic: true })));
      if (e.details) body.push(para(run(e.details)));
    }
  }
  if (cv.skills.length) { body.push(heading(L[3])); body.push(para(run(cv.skills.join(' · ')))); }
  if (cv.projects.length) {
    body.push(heading(L[4]));
    for (const p of cv.projects) {
      body.push(para(run(p.name, { bold: true }) + (p.url ? run(` · ${p.url}`, { color: '4B5563' }) : ''), '<w:spacing w:before="80" w:after="0"/>'));
      if (p.description) body.push(para(run(p.description)));
      p.bullets.forEach((t) => body.push(bullet(t)));
    }
  }
  if (cv.certifications.length) {
    body.push(heading(L[5]));
    cv.certifications.forEach((c) => body.push(bullet([c.name, c.issuer, fmt(c.date)].filter(Boolean).join(' — '))));
  }
  if (cv.languages.length) {
    body.push(heading(L[6]));
    body.push(para(run(cv.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(', '))));
  }

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000" w:header="500" w:footer="500" w:gutter="0"/>${rtl ? '<w:bidi/>' : ''}</w:sectPr></w:body>
</w:document>`;

  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', data: document },
  ]);
}
