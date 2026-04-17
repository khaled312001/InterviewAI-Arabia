# InterviewAI Arabia

Arabic-first AI interview coach. React Native mobile app + Node.js/Express backend + React admin dashboard, backed by Claude.

> شركة برمجلي — https://barmagly.tech

## Monorepo layout

```
/backend   Node 20 + Express + Prisma + MySQL + Claude SDK
/admin     Vite + React 18 + MUI (built → served by backend at /admin)
/mobile    React Native 0.74 + Expo SDK 51 (Android APK via EAS)
/scripts   deploy.sh and ops helpers
```

## Prerequisites

- Node.js 20 LTS (use nvm)
- MySQL 8 (local for dev; Hostinger for prod)
- pnpm or npm
- For mobile: Expo CLI + an Expo account for `eas build`

## Quick start (local dev)

```bash
# 1. Backend
cd backend
cp .env.example .env          # fill in DATABASE_URL, JWT_SECRET, ANTHROPIC_API_KEY
npm install
npx prisma migrate dev
npm run seed
npm run dev                   # http://localhost:4000

# 2. Admin
cd ../admin
cp .env.example .env
npm install
npm run dev                   # http://localhost:5173

# 3. Mobile
cd ../mobile
cp .env.example .env
npm install
npx expo start                # scan QR with Expo Go
```

## Production deployment

On the server (one-time):

```bash
cd /home/u492425110/domains/barmagly.tech/public_html/intervie-ai-arabia
git clone <repo-url> .
cp backend/.env.example backend/.env   # edit with prod values
./scripts/deploy.sh
```

Subsequent deploys: just `./scripts/deploy.sh`. It runs `git pull`, installs deps, runs Prisma migrations, builds the admin, and restarts PM2.

## Environment variables

See each package's `.env.example`. Never commit a real `.env`.

## API

See [docs/API.md](docs/API.md) (generated from routes). Health check: `GET /api/health`.

## Admin

Default admin login is seeded on first run — see `backend/prisma/seed.js` output. Change it immediately.

## Contact

شركة برمجلي — https://barmagly.tech — 01010254819
