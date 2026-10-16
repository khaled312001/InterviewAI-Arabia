/**
 * Text out of an uploaded CV: PDF, Word (.docx) or plain text.
 *
 * .docx is read with the same no-dependency approach docx.js writes it with: a
 * zip's central directory names every entry and where it starts, and
 * word/document.xml is the only entry with the text. Paragraph ends become
 * newlines and the rest of the markup is dropped.
 *
 * Scanned CVs (a PDF that is only an image) produce no text; the caller tells
 * the person to export a text PDF instead of guessing with OCR.
 */

import zlib from 'node:zlib';

// pdf-parse is loaded lazily: its module-level debug branch probes for a test
// fixture that does not exist in a production install and throws at import.
async function parsePdf(buffer) {
  const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
  const plain = await pdfParse(buffer);
  let laid = null;
  try {
    laid = await pdfParse(buffer, { pagerender: renderPageInReadingOrder });
  } catch {
    return plain;
  }
  // The layout pass only ever re-orders text; if it lost a chunk, trust the stream.
  return laid.text.replace(/\s/g, '').length >= plain.text.replace(/\s/g, '').length * 0.9 ? laid : plain;
}

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g;
const LATIN = /[A-Za-z]/g;

/**
 * One page's text in the order a person reads it, not the order it was drawn.
 *
 * Many CV builders draw a page in layers — every heading first, then every
 * bullet — so the raw stream lists four job titles and then twelve bullets with
 * nothing to say which bullet belongs where, and the AI attaches them all to the
 * last job. Placing each piece by its position on the page puts every bullet
 * back under its job.
 *
 * A sidebar layout (a column that runs the full height of the page) is read
 * column by column; anything else is read line by line, top to bottom.
 */
async function renderPageInReadingOrder(pageData) {
  const tc = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
  const items = tc.items
    .filter((i) => typeof i.str === 'string' && i.str.length)
    .map((i) => ({
      s: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0,
      h: Math.abs(i.transform[3]) || Math.abs(i.height) || 10,
      rotated: Math.abs(i.transform[1]) > 0.01 || Math.abs(i.transform[2]) > 0.01,
    }));
  // Sideways text (a margin stamp, a vertical name) has no place in a line; it goes last.
  const sideways = items.filter((i) => i.rotated).map((i) => i.s).join('').trim();
  const flat = items.filter((i) => !i.rotated);
  if (!flat.length) return sideways;
  return [layoutText(flat), sideways].filter(Boolean).join('\n');
}

function layoutText(items) {
  const width = Math.max(...items.map((i) => i.x + i.w));
  let gutter = null;
  // A real gutter is an empty band, not just a line no word happens to cross:
  // words in running text sit flush against each other, so a 1pt test would
  // split ordinary paragraphs down the middle.
  const BAND = 12;
  const inBand = (i, g) => i.x < g + BAND / 2 && i.x + i.w > g - BAND / 2 && i.s.trim();
  const text = items.filter((i) => i.s.trim());
  for (let g = width * 0.2; g <= width * 0.8 && gutter === null; g += 2) {
    const crossing = text.filter((i) => inBand(i, g)).length;
    const left = text.filter((i) => i.x + i.w <= g - BAND / 2).length;
    const right = text.filter((i) => i.x >= g + BAND / 2).length;
    if (crossing <= Math.min(4, text.length * 0.03) && left >= text.length * 0.15 && right >= text.length * 0.15) gutter = g;
  }
  if (gutter === null) return readLines(items);
  const spanning = items.filter((i) => inBand(i, gutter));
  return [
    readLines(spanning),
    readLines(items.filter((i) => !inBand(i, gutter) && i.x + i.w <= gutter)),
    readLines(items.filter((i) => !inBand(i, gutter) && i.x + i.w > gutter)),
  ].filter(Boolean).join('\n\n');
}

function readLines(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= Math.max(2, Math.min(last.h, it.h) * 0.45)) last.items.push(it);
    else lines.push({ y: it.y, h: it.h, items: [it] });
  }
  return lines.map(({ items: parts }) => {
    const text = parts.map((p) => p.s).join('');
    const rtl = (text.match(ARABIC) || []).length > (text.match(LATIN) || []).length;
    parts.sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
    let out = '';
    let edge = null;
    for (const p of parts) {
      const gap = edge === null ? 0 : (rtl ? edge - (p.x + p.w) : p.x - edge);
      if (edge !== null && gap > 1.5 && !/\s$/.test(out) && !/^\s/.test(p.s)) out += gap > 24 ? '   ' : ' ';
      out += p.s;
      edge = rtl ? p.x : p.x + p.w;
    }
    return out.replace(/\s+$/, '');
  }).filter((l) => l.trim()).join('\n');
}

function unzipEntry(buf, wanted) {
  // End-of-central-directory record: last 22 bytes, or further back with a comment.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localAt = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === wanted) {
      const lName = buf.readUInt16LE(localAt + 26);
      const lExtra = buf.readUInt16LE(localAt + 28);
      const start = localAt + 30 + lName + lExtra;
      const data = buf.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data, { maxOutputLength: 20 * 1024 * 1024 });
      throw new Error(`unsupported zip method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function docxText(buffer) {
  const xml = unzipEntry(buffer, 'word/document.xml');
  if (!xml) throw new Error('word/document.xml missing');
  return xml.toString('utf8')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const CV_UPLOAD_TYPES = /\.(pdf|docx|txt|md)$/i;

export function acceptsCvFile(file) {
  return file.mimetype === 'application/pdf'
    || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || file.mimetype === 'text/plain'
    || CV_UPLOAD_TYPES.test(file.originalname || '');
}

/** @returns {Promise<string>} the text, possibly empty */
export async function extractCvText(file) {
  const name = String(file.originalname || '').toLowerCase();
  if (file.mimetype === 'application/pdf' || name.endsWith('.pdf')) {
    const parsed = await parsePdf(file.buffer);
    return String(parsed?.text || '').trim();
  }
  if (name.endsWith('.docx') || file.mimetype.includes('wordprocessingml')) return docxText(file.buffer);
  return file.buffer.toString('utf8').trim();
}
