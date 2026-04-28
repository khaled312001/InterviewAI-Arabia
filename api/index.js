// Vercel serverless entry. Wraps the Express app with serverless-http so a
// single function handles every /api/* request. Static assets (admin, web)
// are served by Vercel's edge directly via root vercel.json routing.
//
// Function memory + maxDuration are configured in vercel.json. Node.js
// version comes from "engines" in package.json. We don't export `config`
// here because Vercel only accepts {"runtime": "edge" | "nodejs"} in that
// shape and the default ("nodejs") is what we want.

import serverless from 'serverless-http';
import { createApp } from '../backend/src/app.js';

const app = createApp();

export default serverless(app);
