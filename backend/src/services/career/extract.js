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
  return pdfParse(buffer);
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
