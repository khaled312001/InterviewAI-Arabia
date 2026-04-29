// Minimal Vercel function — no imports from backend/, no DB, no Express.
// If this responds fast but /api/index.js times out, the bottleneck is in
// backend's import graph (Prisma engines, app construction, etc.).
// If this also times out, the issue is at the Vercel function level.

export default function handler(_req, res) {
  res.status(200).json({
    ok: true,
    time: new Date().toISOString(),
    runtime: 'vercel-minimal',
    region: process.env.VERCEL_REGION || null,
  });
}
