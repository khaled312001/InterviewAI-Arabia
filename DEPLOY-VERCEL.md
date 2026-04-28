# Deploying InterviewAI Arabia to Vercel

This document describes how to deploy the **whole monorepo** (backend API +
admin dashboard + mobile/web bundle) as a single Vercel project, **without**
splitting it into multiple repos.

---

## Architecture on Vercel

```
                ┌─────────────────────────────────────┐
                │  Vercel Edge / CDN                  │
                │                                     │
   /api/* ──────┤  api/index.js  (serverless λ)       │
                │   ↳ wraps Express via               │
                │     serverless-http                 │
                │   ↳ same routes as Hostinger        │
                │                                     │
   /admin/* ───►│  static — backend/public/admin      │  ← Vite build
   /, /login ─►│  static — backend/public/web        │  ← Expo export
                │                                     │
   /api/cron/*  │  Vercel Cron triggers (vercel.json) │
                └─────────────────────────────────────┘
                                    │
                                    │ MySQL over the public internet
                                    ▼
                  Hostinger MySQL (srv2070.hstgr.io:3306)
```

The same `backend/src/app.js` runs on both Hostinger Passenger AND Vercel —
only the wrapper differs (`src/index.js` vs `api/index.js`).

---

## One-time setup

### 1. Whitelist Vercel in Hostinger Remote MySQL

Vercel uses dynamic outbound IPs, so the only practical option is to allow
`Any host` for the MySQL user. From Hostinger hPanel:

1. **Databases → Remote MySQL**
2. Add **`%`** (any host) for user `u492425110_Interview`

> Security note: the DB user only has access to the one `u492425110_Interview`
> database. The risk is bounded; still, consider rotating the password to a
> fresh strong one before opening it up.

### 2. Push the repo

It already lives at `https://github.com/khaled312001/InterviewAI-Arabia`.
Make sure your latest changes are pushed.

### 3. Import the project on Vercel

1. Go to https://vercel.com/new
2. **Import** the GitHub repo
3. **Framework Preset:** `Other` (Vercel will read `vercel.json`)
4. **Root Directory:** leave at repo root (NOT `backend/`)
5. **Install Command:** `npm run install:all` (already in vercel.json)
6. **Build Command:** `npm run build:vercel` (already in vercel.json)
7. **Output Directory:** `backend/public` (already in vercel.json)

Click **Deploy** — first deploy runs `install:all` (installs backend, admin,
mobile deps) then `build:vercel` (builds admin + mobile web into
`backend/public/`). The serverless function `api/index.js` packages the
backend.

### 4. Set environment variables in Vercel

From the project's **Settings → Environment Variables**, copy each line below.
Paste the values from your existing `backend/.env` on Hostinger (or generate
fresh secrets — see notes).

| Name                     | Required | Notes |
|---|---|---|
| `NODE_ENV`               | yes  | `production` |
| `DATABASE_URL`           | yes  | `mysql://u492425110_Interview:<pwd>@srv2070.hstgr.io:3306/u492425110_Interview` |
| `JWT_SECRET`             | yes  | 64+ random chars (`openssl rand -base64 64`) |
| `JWT_EXPIRES_IN`         | no   | default `7d` |
| `JWT_REFRESH_EXPIRES_IN` | no   | default `30d` |
| `CORS_ORIGINS`           | yes  | `https://your-vercel-domain.vercel.app,https://intervie-ai-arabia.barmagly.tech` |
| `AI_ENABLED`             | yes  | `true` |
| `AI_PROVIDER`            | yes  | `groq` |
| `GROQ_API_KEY`           | yes  | from console.groq.com |
| `FREE_DAILY_QUESTION_LIMIT` | no | default `5` |
| `ADMIN_EMAIL`            | first deploy only | seed admin email |
| `ADMIN_PASSWORD`         | first deploy only | seed admin password |
| `PAYMOB_ENABLED`         | optional | `true` once configured |
| `PAYMOB_API_KEY`         | optional | from accept.paymob.com |
| `PAYMOB_INTEGRATION_ID`  | optional | from Paymob dashboard |
| `PAYMOB_IFRAME_ID`       | optional | from Paymob dashboard |
| `PAYMOB_HMAC_SECRET`     | optional | from Paymob dashboard |
| `CRON_SECRET`            | yes for Vercel Cron | random string; Vercel auto-injects this in cron headers |

### 5. Initial DB seed

Vercel doesn't run the seed script automatically. From your laptop, with the
production `DATABASE_URL` exported, run **once**:

```bash
cd backend
DATABASE_URL='mysql://...' node prisma/seed.js
DATABASE_URL='mysql://...' node prisma/seed-big.js   # optional
```

(If you already seeded the Hostinger DB, skip this — it's the same database.)

### 6. Verify

After the first deploy succeeds, your app is live at
`https://<your-project>.vercel.app`. Smoke-test:

- `/api/health` → `{ status: "ok", runtime: "vercel", ... }`
- `/admin/` → admin login page
- `/` → Expo web app
- `/api/categories` → list of categories from the DB

---

## Trade-offs vs Hostinger

| | Hostinger (current) | Vercel |
|---|---|---|
| Cost | $0 (already paid) | Free tier covers most usage |
| Server type | Persistent Passenger | Serverless functions |
| Cold start | None | ~500ms–2s after idle |
| Cron | In-process node-cron | Vercel Cron (HTTP) |
| Static assets | Express | Vercel Edge CDN (fast globally) |
| File uploads | 5 MB via multer | 4.5 MB Vercel hard limit |
| Function timeout | none | 60 s (hobby) / 300 s (pro) |
| MySQL | localhost-fast | over public internet (whitelist needed) |

**Recommendation:** keep Hostinger as the canonical deployment. Vercel is
useful as a global mirror or fallback. The same repo deploys to both.

---

## Local dev

Unchanged:

```bash
cd backend && npm install && npm run dev    # http://localhost:4000
cd admin   && npm install && npm run dev    # http://localhost:5173
cd mobile  && npm install && npx expo start --web
```

---

## Rollback

If a Vercel deploy breaks something, the previous deploy is one click away
(**Deployments → ⋯ → Promote to production**). Hostinger remains live and
unaffected — you can switch DNS back to it any time.
