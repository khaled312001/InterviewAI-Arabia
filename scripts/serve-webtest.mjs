/**
 * Serve a local web export as if it were the deployed site.
 *
 * Regression-testing the web build against the real API needs SAME-ORIGIN:
 * the backend's CORS allowlist does not contain localhost, so a plain static
 * server gets a 200 with no `access-control-allow-origin` and every request
 * fails silently inside the browser — which looks exactly like a broken app.
 *
 * This serves the export at / and proxies /api to production, so the page sees
 * one origin and authentication works. Nothing is deployed and production
 * config is untouched.
 *
 *   node scripts/serve-webtest.mjs [dir] [port]
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.resolve(ROOT, process.argv[2] || '.webtest');
const PORT = Number(process.argv[3] || 8099);
const UPSTREAM = process.env.UPSTREAM || 'https://interprova.com';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.map': 'application/json',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.startsWith('/api')) {
    const body = req.method === 'GET' || req.method === 'HEAD'
      ? undefined
      : await new Promise((resolve) => {
          const parts = [];
          req.on('data', (c) => parts.push(c));
          req.on('end', () => resolve(Buffer.concat(parts)));
        });

    const headers = { ...req.headers };
    delete headers.host;      // must be the upstream's
    delete headers.origin;    // same-origin as far as the API is concerned
    delete headers.referer;
    delete headers['accept-encoding'];

    try {
      const upstream = await fetch(UPSTREAM + url.pathname + url.search, {
        method: req.method, headers, body,
      });
      const buf = Buffer.from(await upstream.arrayBuffer());
      const out = {};
      upstream.headers.forEach((v, k) => {
        if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) out[k] = v;
      });
      res.writeHead(upstream.status, out);
      res.end(buf);
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `proxy: ${e.message}` }));
    }
    return;
  }

  // Static, with an SPA fallback so deep links resolve to index.html.
  let file = path.join(DIR, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIR)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const index = path.join(file, 'index.html');
    file = fs.existsSync(index) ? index : path.join(DIR, 'index.html');
  }
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`serving ${DIR} on http://127.0.0.1:${PORT} (api -> ${UPSTREAM})`);
});
