// Vercel serverless entry. Skips serverless-http and just dispatches the
// request through Express directly (Express's app object IS a function with
// signature (req, res) → void). This avoids any wrapper-level overhead and
// gives us a clean async boundary we can await for response completion.

let cached = null;
let cachedError = null;

async function getApp() {
  if (cached) return cached;
  if (cachedError) throw cachedError;

  const t0 = Date.now();
  const log = (msg) => console.log(`[boot ${(Date.now() - t0).toString().padStart(5, ' ')}ms] ${msg}`);

  try {
    log('start');
    const mod = await import('../src/app.js');
    log('imported app.js');
    cached = mod.createApp();
    log('createApp() done');
    return cached;
  } catch (err) {
    cachedError = err;
    console.error('[boot FAILED]', err);
    throw err;
  }
}

export default async function handler(req, res) {
  try {
    const app = await getApp();
    // Express dispatch — wait until response is sent so Vercel keeps the
    // function alive long enough to complete async work.
    return new Promise((resolve, reject) => {
      res.on('finish', resolve);
      res.on('close', resolve);
      res.on('error', reject);
      app(req, res);
    });
  } catch (err) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: 'Function failed to initialise',
        message: err?.message || String(err),
      }));
    }
  }
}
