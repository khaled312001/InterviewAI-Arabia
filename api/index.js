// Vercel serverless entry. Wraps the Express app with serverless-http so a
// single function handles every /api/* request. Static assets (admin, web)
// are served by Vercel's edge directly via root vercel.json routing.
//
// We import the app inside an init() called per-request and catch any
// boot/import error, so module-load crashes return a useful JSON body
// instead of Vercel's opaque FUNCTION_INVOCATION_FAILED.

import serverless from 'serverless-http';

let cached = null;
let cachedError = null;

async function getHandler() {
  if (cached) return cached;
  if (cachedError) throw cachedError;
  try {
    const { createApp } = await import('../backend/src/app.js');
    cached = serverless(createApp());
    return cached;
  } catch (err) {
    cachedError = err;
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
