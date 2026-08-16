# InterviewAI Arabia — Backend

Express API + Prisma + MySQL + Groq, deployable to Vercel (serverless) or
Hostinger (Passenger). Frontend lives in
[InterviewAI-Arabia](https://github.com/khaled312001/InterviewAI-Arabia).

## Deploy on Vercel

1. Push this repo to `khaled312001/InterviewAI-Arabia-Backend` (private)
2. Import on https://vercel.com/new — framework: **Other**
3. Set environment variables (Settings → Environment Variables) — see
   [`.env.example`](.env.example) for the full list. Minimum to boot:

   - `DATABASE_URL` — `mysql://u492425110_Interview:<pwd>@srv1340.hstgr.io:3306/u492425110_Interview`
   - `JWT_SECRET` — 32+ random characters
   - `GROQ_API_KEY` + `AI_ENABLED=true`
   - `CORS_ORIGINS` — include the frontend's Vercel URL
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD`

4. Whitelist Vercel's outbound IPs in Hostinger Remote MySQL (or set
   "Any host" with a strong DB password — see notes)
5. Deploy

The build runs `prisma generate` automatically (`vercel-build` script in
package.json) so the Prisma client always matches the deployed schema.

## Deploy on Hostinger (legacy / canonical)

```bash
ssh -p 65002 u492425110@<server>
cd ~/domains/barmagly.tech/interviewai-nodejs-backend
git clone <this-repo> .
cp .env.example .env  # edit with real values
/opt/alt/alt-nodejs22/root/bin/npm install
/opt/alt/alt-nodejs22/root/bin/npx prisma generate
touch tmp/restart.txt   # if Passenger is configured
```

## Local development

```bash
npm install
cp .env.example .env  # set DATABASE_URL etc.
npx prisma generate
npm run dev   # http://localhost:4000
npm run seed  # populate categories + questions
```

## API

See routes in `src/routes/`. Health check: `GET /api/health`.

## Cron jobs

- `POST /api/cron/daily` — combined: daily quota reset + subscription expiry
- Triggered by Vercel Cron (configured in `vercel.json`) at 22:00 UTC = 00:00 Africa/Cairo
- Bypasses auth from loopback; otherwise requires `Authorization: Bearer ${CRON_SECRET}`

## Architecture choices

- **mysql2** for list/aggregate queries — Prisma's library engine panics on
  Hostinger's CloudLinux (OpenSSL 1.1) for some `findMany` queries; mysql2
  is unaffected. Prisma stays for writes and single-row reads.
- **bcryptjs** instead of bcrypt — pure-JS, no native binding to load on
  cold start. Marginally slower at hashing time but inconsequential at our
  request volume.
- **Lazy imports** for heavy SDKs (`@anthropic-ai/sdk`) — only loaded if
  `AI_PROVIDER=claude`.
- **Single Prisma binary target** (`rhel-openssl-3.0.x`) — Vercel's
  Amazon Linux 2023 runtime; trimmed unused targets to keep cold start fast.
