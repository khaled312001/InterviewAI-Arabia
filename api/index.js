// Vercel serverless entry. Wraps the Express app with serverless-http so a
// single function handles every /api/* request. Static assets (admin, web)
// are served by Vercel's edge directly via root vercel.json routing.

import serverless from 'serverless-http';
import { createApp } from '../backend/src/app.js';

const app = createApp();
const handler = serverless(app, {
  // Vercel's default body parsing limits are tight; raise for our CV uploads.
  request: (req) => {
    // Strip Vercel's /api prefix because Express routes already include it.
    // (Without this, /api/health → "/api/health" inside Express, which works,
    // so this is a no-op kept for clarity.)
    return req;
  },
});

export default handler;

// Vercel-specific function config — single export tells Vercel how to run us.
export const config = {
  // Use the Node.js runtime (not Edge) so we can use Prisma + mysql2 + multer.
  runtime: 'nodejs20.x',
  // Allow the full body — CV uploads can be up to 5 MB.
  bodyParser: { sizeLimit: '5mb' },
};
