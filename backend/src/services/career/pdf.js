/**
 * Real PDF files for CVs and cover letters, made by headless Chrome.
 *
 * The page is the same HTML the preview shows, printed with Chrome's own
 * print-to-PDF: the design comes out exactly as designed (colours to the edge,
 * fonts, photo, charts), and the text stays real, selectable text in reading
 * order — what an applicant-tracking system reads.
 *
 * The browser is `chrome-headless-shell`, installed next to the app (not in the
 * repo) with:
 *   npx @puppeteer/browsers install chrome-headless-shell@stable --path ~/chrome-pdf
 * Set CHROME_PDF_BIN to point elsewhere. Without it, `pdfAvailable()` is false
 * and the caller falls back to the print page (the browser's own dialog).
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { logger } from '../../utils/logger.js';

function findBinary() {
  if (process.env.CHROME_PDF_BIN && fs.existsSync(process.env.CHROME_PDF_BIN)) return process.env.CHROME_PDF_BIN;
  const root = path.join(os.homedir(), 'chrome-pdf', 'chrome-headless-shell');
  try {
    const versions = fs.readdirSync(root).filter((d) => d.startsWith('linux-')).sort();
    for (const v of versions.reverse()) {
      const bin = path.join(root, v, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (fs.existsSync(bin)) return bin;
    }
  } catch {
    /* not installed */
  }
  return null;
}

let BIN;
export function pdfAvailable() {
  if (BIN === undefined) BIN = findBinary();
  return Boolean(BIN);
}

/* Chrome is heavy on a shared host: at most two at a time, the rest wait. */
const MAX_RUNNING = 2;
let running = 0;
const queue = [];
const acquire = () => new Promise((resolve) => {
  if (running < MAX_RUNNING) { running += 1; resolve(); } else queue.push(resolve);
});
const release = () => {
  const next = queue.shift();
  if (next) next(); else running -= 1;
};

/**
 * Print an HTML document (A4, the page's own @page rules) to a PDF buffer.
 * Rejects when Chrome is missing, fails or takes longer than 45 s.
 */
export async function htmlToPdf(html) {
  if (!pdfAvailable()) throw new Error('PDF renderer not installed');
  await acquire();
  const id = crypto.randomBytes(8).toString('hex');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cvpdf-'));
  const src = path.join(dir, `${id}.html`);
  const out = path.join(dir, `${id}.pdf`);
  try {
    fs.writeFileSync(src, html);
    await new Promise((resolve, reject) => {
      execFile(BIN, [
        '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--hide-scrollbars', '--no-pdf-header-footer', '--run-all-compositor-stages-before-draw',
        // Wide enough that no phone layout applies; the print rules set the paper.
        '--window-size=1200,1700',
        // Time for the web fonts and images to arrive before printing.
        '--virtual-time-budget=10000',
        `--user-data-dir=${path.join(dir, 'profile')}`,
        `--print-to-pdf=${out}`,
        `file://${src}`,
      ], { timeout: 45_000, maxBuffer: 4 * 1024 * 1024 }, (err) => (err && !fs.existsSync(out) ? reject(err) : resolve()));
    });
    const buf = fs.readFileSync(out);
    if (buf.length < 1000 || buf.subarray(0, 4).toString() !== '%PDF') throw new Error('Chrome produced no PDF');
    return buf;
  } catch (err) {
    logger.warn(`pdf render failed: ${err?.message}`);
    throw err;
  } finally {
    release();
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }
}
