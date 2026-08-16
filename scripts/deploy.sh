#!/usr/bin/env bash
#
# Deploy InterviewAI Arabia to Hostinger (single Node process behind LiteSpeed).
#
#   ./scripts/deploy.sh              # full deploy
#   ./scripts/deploy.sh --backend    # backend code only (fast)
#   ./scripts/deploy.sh --frontends  # landing + admin + web bundle only
#   ./scripts/deploy.sh --migrate    # run the SQL migration only
#
# Layout on the server:
#   ~/domains/khaledahmed.net/interview-backend/     app root (Passenger)
#     ├── src/ prisma/ package.json server.cjs .env
#     └── public/{landing,admin,web}                 static frontends
#
# Requires: an SSH key already installed for u405809647@145.79.20.56:65002.

set -euo pipefail

SSH_KEY="${SSH_KEY:-$HOME/.ssh/interview_prod_ed25519}"
SSH_HOST="${SSH_HOST:-u405809647@145.79.20.56}"
SSH_PORT="${SSH_PORT:-65002}"
APP_DIR="domains/khaledahmed.net/interview-backend"
NODE="/opt/alt/alt-nodejs20/root/bin/node"
NPM="/opt/alt/alt-nodejs20/root/bin/npm"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH=(ssh -i "$SSH_KEY" -p "$SSH_PORT" -o StrictHostKeyChecking=no -o BatchMode=yes "$SSH_HOST")
SCP_PORT_FLAG=(-P "$SSH_PORT")

DO_BACKEND=1; DO_FRONTENDS=1; DO_MIGRATE=0
case "${1:-}" in
  --backend)   DO_FRONTENDS=0 ;;
  --frontends) DO_BACKEND=0 ;;
  --migrate)   DO_BACKEND=0; DO_FRONTENDS=0; DO_MIGRATE=1 ;;
  "")          ;;
  *) echo "unknown flag: $1"; exit 2 ;;
esac

say() { printf '\n\033[1;34m▸ %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- build
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

if [ "$DO_FRONTENDS" = 1 ]; then
  say "Building admin dashboard"
  (cd "$ROOT/admin" && npm run build)

  say "Building Expo web bundle"
  (cd "$ROOT/mobile" && npm run build:web)

  mkdir -p "$STAGE/public"
  cp -r "$ROOT/admin/dist"   "$STAGE/public/admin"
  cp -r "$ROOT/mobile/dist"  "$STAGE/public/web"
  cp -r "$ROOT/landing"      "$STAGE/public/landing"
  # Never ship source maps or the deploy script itself to the public root.
  find "$STAGE/public" -name '*.map' -delete
fi

if [ "$DO_BACKEND" = 1 ]; then
  mkdir -p "$STAGE/backend"
  cp -r "$ROOT/backend/src"          "$STAGE/backend/src"
  cp -r "$ROOT/backend/prisma"       "$STAGE/backend/prisma"
  cp    "$ROOT/backend/package.json" "$STAGE/backend/"
  cp    "$ROOT/backend/server.cjs"   "$STAGE/backend/" 2>/dev/null || true
fi

# --------------------------------------------------------------- upload
say "Uploading"
"${SSH[@]}" "mkdir -p ~/$APP_DIR/public ~/$APP_DIR/tmp"

if [ "$DO_BACKEND" = 1 ]; then
  tar -C "$STAGE/backend" -czf "$STAGE/backend.tgz" .
  scp "${SCP_PORT_FLAG[@]}" -i "$SSH_KEY" -o StrictHostKeyChecking=no \
      "$STAGE/backend.tgz" "$SSH_HOST:~/$APP_DIR/_deploy.tgz"
  "${SSH[@]}" "cd ~/$APP_DIR && rm -rf src prisma && tar -xzf _deploy.tgz && rm -f _deploy.tgz && echo '  backend extracted'"
fi

if [ "$DO_FRONTENDS" = 1 ]; then
  tar -C "$STAGE/public" -czf "$STAGE/public.tgz" .
  scp "${SCP_PORT_FLAG[@]}" -i "$SSH_KEY" -o StrictHostKeyChecking=no \
      "$STAGE/public.tgz" "$SSH_HOST:~/$APP_DIR/_public.tgz"
  "${SSH[@]}" "cd ~/$APP_DIR/public && rm -rf landing admin web && tar -xzf ../_public.tgz && rm -f ../_public.tgz && echo '  frontends extracted'"
fi

# ------------------------------------------------------------ migrate db
if [ "$DO_MIGRATE" = 1 ] || [ "$DO_BACKEND" = 1 ]; then
  say "Applying database migration"
  scp "${SCP_PORT_FLAG[@]}" -i "$SSH_KEY" -o StrictHostKeyChecking=no \
      "$ROOT/backend/prisma/migrations/001_monetisation_and_auth.sql" \
      "$SSH_HOST:~/$APP_DIR/_migration.sql"
  "${SSH[@]}" bash -s <<'REMOTE'
set -euo pipefail
APP=~/domains/khaledahmed.net/interview-backend
NODE=/opt/alt/alt-nodejs20/root/bin/node
cd "$APP"
# Parse credentials out of .env without ever printing them.
eval "$($NODE -e '
const fs=require("fs");
const t=fs.readFileSync(".env","utf8");
const m=t.match(/^DATABASE_URL="?([^"\n]+)"?/m);
const u=new URL(m[1]);
const q=s=>"\x27"+String(s).replace(/\x27/g,"\x27\\\x27\x27")+"\x27";
console.log("DBUSER="+q(decodeURIComponent(u.username)));
console.log("MYSQL_PWD="+q(decodeURIComponent(u.password)));
console.log("DBNAME="+q(u.pathname.slice(1)));
')"
export MYSQL_PWD
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p ~/backups
mysqldump -u "$DBUSER" --single-transaction --routines --triggers "$DBNAME" > ~/backups/auto-$STAMP.sql
echo "  backup: ~/backups/auto-$STAMP.sql"
mysql -u "$DBUSER" "$DBNAME" < _migration.sql
rm -f _migration.sql
echo "  migration applied"
REMOTE
fi

# ------------------------------------------------------- install & restart
if [ "$DO_BACKEND" = 1 ]; then
  say "Installing dependencies and generating Prisma client"
  "${SSH[@]}" "cd ~/$APP_DIR && $NPM install --omit=dev --no-audit --no-fund 2>&1 | tail -5 && npx prisma generate 2>&1 | tail -3"
fi

say "Restarting application"
# Passenger watches restart.txt in PassengerRestartDir.
"${SSH[@]}" "mkdir -p ~/$APP_DIR/tmp && touch ~/$APP_DIR/tmp/restart.txt && echo '  restart signalled'"

say "Smoke test"
sleep 6
for path in /api/health /api/categories /api/payments/config /; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 30 "https://interview.khaledahmed.net$path" || echo 000)
  printf '  %-24s %s\n' "$path" "$code"
done

say "Done → https://interview.khaledahmed.net"
