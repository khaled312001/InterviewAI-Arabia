# Deploying InterviewAI Arabia to Vercel — frontend repo

This repo hosts only the **frontend** (admin dashboard + Expo web bundle).
The API backend lives in
[InterviewAI-Arabia-Backend](https://github.com/khaled312001/InterviewAI-Arabia-Backend)
as a separate Vercel project.

```
                                      ┌──────────────────────────┐
  https://interview-ai-arabia.        │  Vercel project A        │
  vercel.app                          │  (this repo)             │
        ▼                             │                          │
        ├─ /admin/*  ───────────────► │  static admin/dist       │
        ├─ /, /login, /home, ... ──►  │  static mobile/dist      │
        └─ /api/*  ─────────────────► │  rewrite (server-side)   │
                                      └───────────┬──────────────┘
                                                  │  same-origin to the browser
                                                  ▼
                                      ┌──────────────────────────┐
                                      │  Vercel project B        │
                                      │  (InterviewAI-Arabia-    │
                                      │   Backend)               │
                                      │  api/index.js (Express)  │
                                      │  → Hostinger MySQL       │
                                      │  → Groq                  │
                                      └──────────────────────────┘
```

**`/api/*` is a rewrite, not a cross-origin call.** The browser only ever
talks to project A, so there is no preflight, no `CORS_ORIGINS` to keep in
sync, and no hardcoded backend hostname compiled into the two front ends.
Both clients simply use the relative `/api`.

The backend URL lives in exactly one place: the first entry of `rewrites` in
`vercel.json` at the repo root. Point that at a different backend deployment
and both the admin and the web app follow. (Vercel does not interpolate env
vars into `vercel.json`, so this is a literal — it is a deploy-config edit,
not a code change.)

## Setup (one-time)

1. Push this repo to `khaled312001/InterviewAI-Arabia` (already done).
2. **vercel.com/new** → import the repo.
3. Framework: **Other** (Vercel will read `vercel.json`).
4. Root Directory: leave at repo root.
5. Deploy.

No env vars are needed. To point a build at a different backend *without*
editing the rewrite — e.g. testing the admin against localhost — set an
absolute base and accept that it becomes a genuine cross-origin call which
the backend's `CORS_ORIGINS` must then allow:

- Mobile build:  `EXPO_PUBLIC_API_BASE_URL=https://your-backend.vercel.app/api`
- Admin build:   `VITE_API_BASE_URL=https://your-backend.vercel.app/api`

## Backend setup

See InterviewAI-Arabia-Backend's README for backend deploy steps.

`CORS_ORIGINS` is only consulted for requests that arrive with an `Origin`
header. Through the rewrite there is none, so it does not need this
frontend's domain. Add the domain there only if you switch a build to an
absolute `*_API_BASE_URL` as above.

If the backend fails to boot (bad `DATABASE_URL`, `JWT_SECRET` under 32
chars), `api/index.js` answers **503 `BOOT_FAILED`** rather than a bare 500,
and still emits CORS headers so the status reaches the browser instead of
being swallowed as a CORS error. The cause is in the function logs — it is
deliberately not in the response body, because boot errors quote the config
that failed to parse, credentials included.

## Local dev

```bash
npm run install:all       # installs admin + mobile deps
npm run dev:admin         # admin dashboard on :5173
npm run dev:mobile        # Expo web (or QR for native)
```
