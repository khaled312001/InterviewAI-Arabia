#!/usr/bin/env bash
# deploy.sh — run on the Hostinger server to pull latest, build, and restart.
# Usage:  ./scripts/deploy.sh
set -euo pipefail

APP_NAME="interviewai-arabia"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo ">> [1/6] git pull"
git fetch --all --prune
git reset --hard origin/main

echo ">> [2/6] backend: install"
cd "$ROOT_DIR/backend"
npm ci --omit=dev

echo ">> [3/6] backend: prisma generate + migrate deploy"
npx prisma generate
npx prisma migrate deploy

echo ">> [4/6] admin: install + build"
cd "$ROOT_DIR/admin"
npm ci
npm run build
# Copy build into backend/public/admin so Express can serve it
rm -rf "$ROOT_DIR/backend/public/admin"
mkdir -p "$ROOT_DIR/backend/public"
cp -r dist "$ROOT_DIR/backend/public/admin"

echo ">> [5/6] pm2 restart (or start if not running)"
cd "$ROOT_DIR/backend"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  pm2 start src/index.js --name "$APP_NAME" --time
fi
pm2 save

echo ">> [6/6] health check"
sleep 2
curl -fsS http://127.0.0.1:${PORT:-4000}/api/health || {
  echo "!! health check failed; see pm2 logs $APP_NAME"; exit 1;
}
echo ">> deploy OK"
