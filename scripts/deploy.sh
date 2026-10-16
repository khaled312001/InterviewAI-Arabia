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
#   ~/domains/interprova.com/interprova-backend/     app root (Passenger)
#     ├── src/ prisma/ package.json server.cjs .env
#     └── public/{landing,admin,web}                 static frontends
#
# Requires: an SSH key already installed for u405809647@145.79.20.56:65002.

set -euo pipefail

SSH_KEY="${SSH_KEY:-$HOME/.ssh/interview_prod_ed25519}"
# The box moved: 145.79.20.56 stopped answering (publickey AND password both
# refused) while the same key works on 82.25.113.109 — same user, same port,
# hostname fr-int-web1511. Hostinger renumbers shared hosts without notice, so
# this is a value to check first when a deploy fails at the very first step.
SSH_HOST="${SSH_HOST:-u405809647@82.25.113.109}"
SSH_PORT="${SSH_PORT:-65002}"
APP_DIR="domains/interprova.com/interprova-backend"
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
  # Page bodies are build INPUT; the assembled pages are already in landing/.
  rm -rf "$STAGE/public/landing/pages"

  # Content-address the landing assets. Metro already does this for /app and
  # Vite for /admin; the marketing site had nothing, which is how a year-long
  # cache header ended up pinned to a name like `shots/app-home.png`.
  say "Fingerprinting landing assets"
  node "$ROOT/scripts/fingerprint-assets.mjs" "$STAGE/public/landing"
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
  say "Applying database migrations"
  # Every *.sql in the migrations directory, in filename order. They are all
  # written to be idempotent (Hostinger's shared MySQL has no shadow database,
  # so `prisma migrate deploy` cannot run and there is no _prisma_migrations
  # bookkeeping) — re-applying the whole set on every deploy is the design, not
  # a shortcut. Concatenating them here means adding 003 needs no deploy edit.
  MIGRATIONS="$ROOT/backend/prisma/migrations"
  : > "$STAGE/_migration.sql"
  # A bare glob, NOT $(ls ...): $ROOT contains a space ("F:/InterviewAI Arabia"),
  # so command substitution word-splits every path in half. Bash expands globs
  # in collation order already, which is the ordering this loop needs anyway.
  for sql in "$MIGRATIONS"/*.sql; do
    echo "  + $(basename "$sql")"
    printf '\n-- ===== %s =====\n' "$(basename "$sql")" >> "$STAGE/_migration.sql"
    cat "$sql" >> "$STAGE/_migration.sql"
    printf '\n' >> "$STAGE/_migration.sql"
  done
  scp "${SCP_PORT_FLAG[@]}" -i "$SSH_KEY" -o StrictHostKeyChecking=no \
      "$STAGE/_migration.sql" "$SSH_HOST:~/$APP_DIR/_migration.sql"
  "${SSH[@]}" bash -s <<'REMOTE'
set -euo pipefail
APP=~/domains/interprova.com/interprova-backend
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
  # PATH, not bare `npx`: the alt-nodejs20 toolchain is not on the default
  # login PATH, so `npx prisma generate` died with "command not found" — and
  # because that step is what teaches the client about new models, the deploy
  # reported success while every route touching a new table would have thrown
  # "cannot read properties of undefined". --ignore-scripts then invokes the
  # generator explicitly, so a generator failure is a visible failure rather
  # than an npm postinstall exit 127 buried in install output.
  # `set -o pipefail` is the whole point of this line and was missing.
  #
  # Every step here ends in `| tail -N`, and a pipeline's exit status is its
  # LAST command's — so `tail` succeeding reported the step as succeeding. On
  # 2026-10-11 that hid `prisma generate` failing outright, and the deploy
  # printed a clean bill of health while the server ran a client that had never
  # heard of the column the release depended on.
  #
  # Prisma is invoked through node rather than through its own bin, because the
  # symlink at node_modules/.bin/prisma points at a plain .js file with no
  # execute bit: running it directly is "Permission denied", which reads like a
  # transient infrastructure complaint and is not one.
  "${SSH[@]}" "set -o pipefail \
    && cd ~/$APP_DIR \
    && export PATH=/opt/alt/alt-nodejs20/root/bin:\$PATH \
    && export TOKIO_WORKER_THREADS=1 \
    && $NPM install --omit=dev --no-audit --no-fund --ignore-scripts 2>&1 | tail -5 \
    && $NODE ./node_modules/prisma/build/index.js generate 2>&1 | tail -3"

  say "Verifying the generated client knows the current schema"
  #
  # FIELDS, not just models. Checking models alone is what let the 2026-10-11
  # deploy pass: the release added a COLUMN to an existing table, every model
  # was still present in the stale client, and the check said so cheerfully
  # while `prisma.meetingSession.update({ data: { voiceContext } })` was
  # guaranteed to throw on the first live call.
  #
  # The field test is a plain substring search, which cannot produce a false
  # alarm but can miss a stale field whose name happens to appear elsewhere in
  # the generated types. That is the right trade for a deploy gate: it catches
  # every newly added name, which is the case that actually occurs.
  #
  "${SSH[@]}" bash -s <<'REMOTE'
set -euo pipefail
cd ~/domains/interprova.com/interprova-backend
/opt/alt/alt-nodejs20/root/bin/node -e '
const fs = require("fs");
const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
const dts = fs.readFileSync("node_modules/.prisma/client/index.d.ts", "utf8");

const problems = [];
let models = 0;
let fields = 0;

for (const block of schema.matchAll(/^model\s+(\w+)\s*\{([^}]*)\}/gm)) {
  const [, model, body] = block;
  models += 1;
  if (!dts.includes("export type " + model + " =")) { problems.push("model " + model); continue; }
  for (const line of body.split("\n")) {
    const field = line.match(/^\s*(\w+)\s+\S/);
    if (!field) continue;
    fields += 1;
    if (!dts.includes(field[1])) problems.push(model + "." + field[1]);
  }
}

if (problems.length) {
  console.error("  STALE CLIENT, missing: " + problems.join(", "));
  process.exit(1);
}
console.log("  client covers " + models + " models and all " + fields + " fields");
'
REMOTE
fi

say "Restarting application"
# Passenger watches restart.txt in PassengerRestartDir.
"${SSH[@]}" "mkdir -p ~/$APP_DIR/tmp && touch ~/$APP_DIR/tmp/restart.txt && echo '  restart signalled'"

say "Smoke test"
sleep 6
for path in /api/health /api/categories /api/payments/config /; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 30 "https://interprova.com$path" || echo 000)
  printf '  %-24s %s\n' "$path" "$code"
done

say "Done → https://interprova.com"
