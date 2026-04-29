// Vercel serverless entry. Wraps the Express app with serverless-http so a
// single function handles every /api/* request. Heavily instrumented during
// the cold-start debug to pinpoint which import is slow.

import serverless from 'serverless-http';

let cached = null;
let cachedError = null;

async function getHandler() {
  if (cached) return cached;
  if (cachedError) throw cachedError;

  const t0 = Date.now();
  const log = (msg) => console.log(`[boot ${(Date.now() - t0).toString().padStart(5, ' ')}ms] ${msg}`);

  try {
    log('start');
    const mod = await import('../backend/src/app.js');
    log('imported app.js');
    const app = mod.createApp();
    log('createApp() done');
    cached = serverless(app);
    log('serverless wrapper ready');
    return cached;
  } catch (err) {
    cachedError = err;
    console.error('[boot FAILED]', err);
    throw err;
  }
}

export default async function handler(req, res) {
  try {
    const fn = await getHandler();
    return fn(req, res);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: 'Function failed to initialise',
      message: err?.message || String(err),
      stack: process.env.NODE_ENV === 'production' ? undefined : err?.stack,
    }));
  }
}
