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

/**
 * CORS for requests the Express app never got to handle.
 *
 * When the app fails to boot — a bad DATABASE_URL, a short JWT_SECRET, a
 * missing build artefact — the cors() middleware inside it never runs, so the
 * error response carries no access-control-allow-* headers. The browser then
 * reports a CORS failure and discards the response, and the actual boot error
 * is invisible to whoever is debugging: a broken backend and a
 * misconfigured-CORS backend look identical from the client, and the OPTIONS
 * preflight fails before the real request is ever attempted. Answering
 * preflights and labelling error responses here is what makes the difference
 * legible from the outside.
 *
 * The allow-list is read straight from process.env rather than config/env.js,
 * because config/env.js is one of the modules that can be the thing failing.
 */
function corsOrigins() {
  return String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function applyCors(req, res) {
  const origin = req.headers?.origin;
  if (!origin) return;
  // Never reflect an arbitrary origin: with credentials: true that would let
  // any site read authenticated responses.
  if (!corsOrigins().includes(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader(
    'Access-Control-Allow-Headers',
    req.headers['access-control-request-headers'] || 'Content-Type, Authorization, X-Request-Id',
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');
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
    console.error('[handler] app unavailable', err);
    if (res.headersSent) return undefined;

    applyCors(req, res);

    // A preflight is answerable without the app: it asks whether the origin is
    // allowed, which is env, not application state. Failing it would mask the
    // 503 below behind a CORS error and hide the real fault.
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }

    // 503, not 500: the service is not initialised, and the message is
    // generic on purpose. The old version returned `err.message` to the
    // internet, and boot errors routinely quote the offending config — a
    // failed DATABASE_URL parse puts the connection string, credentials
    // included, straight into the response body. The detail is logged above.
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      error: 'Service unavailable',
      code: 'BOOT_FAILED',
    }));
  }
}
