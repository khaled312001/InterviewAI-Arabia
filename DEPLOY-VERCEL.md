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
        └─ /api/* ─── cross-origin ─► │  Vercel project B        │
                                      │  (InterviewAI-Arabia-    │
                                      │   Backend)               │
                                      │                          │
                                      │  api/index.js (Express)  │
                                      │  → Hostinger MySQL       │
                                      │  → Groq                  │
                                      └──────────────────────────┘
```

## Setup (one-time)

1. Push this repo to `khaled312001/InterviewAI-Arabia` (already done).
2. **vercel.com/new** → import the repo.
3. Framework: **Other** (Vercel will read `vercel.json`).
4. Root Directory: leave at repo root.
5. Deploy.

No env vars are needed — the frontend ships static and calls the backend
absolutely. If you want to override the API URL (for testing against a
different backend), set:

- Mobile build:  `EXPO_PUBLIC_API_BASE_URL=https://your-backend.vercel.app/api`
- Admin build:   `VITE_API_BASE_URL=https://your-backend.vercel.app/api`

## Backend setup

See InterviewAI-Arabia-Backend's README for backend deploy steps. The
backend's `CORS_ORIGINS` env var must include this frontend's Vercel
domain, e.g. `https://interview-ai-arabia.vercel.app`.

## Local dev

```bash
npm run install:all       # installs admin + mobile deps
npm run dev:admin         # admin dashboard on :5173
npm run dev:mobile        # Expo web (or QR for native)
```
