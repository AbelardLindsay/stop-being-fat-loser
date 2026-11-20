#!/usr/bin/env bash
# One-shot setup for Linux/macOS.
#   ./scripts/setup.sh cloudflare   deploy to Cloudflare Workers + D1 (free plan, no server)
#   ./scripts/setup.sh selfhost     run on this machine or a VPS (local workerd + SQLite, long polling)
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:-}"
if [ -z "$mode" ]; then
  read -rp "Run on (1) Cloudflare or (2) this machine / VPS? [1/2] " choice
  case "$choice" in 2) mode=selfhost ;; *) mode=cloudflare ;; esac
fi
case "$mode" in cloudflare | selfhost) ;; *) echo "Usage: $0 [cloudflare|selfhost]" >&2; exit 1 ;; esac

node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)' \
  || { echo "Node.js >= 22.18 is required." >&2; exit 1; }
npm install --no-fund --no-audit

read -rsp "Telegram bot token (from @BotFather): " token; echo
read -rp "Allowed Telegram user IDs, owner first, comma-separated (empty: the bot tells you yours): " ids
secret="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"

if [ "$mode" = cloudflare ]; then
  npx wrangler whoami 2>/dev/null | grep -q "You are logged in" || npx wrangler login

  secrets_file="$(mktemp)"
  trap 'rm -f "$secrets_file"' EXIT
  chmod 600 "$secrets_file"
  TOKEN="$token" SECRET="$secret" IDS="$ids" node -e 'console.log(JSON.stringify({
    TELEGRAM_BOT_TOKEN: process.env.TOKEN, TELEGRAM_WEBHOOK_SECRET: process.env.SECRET, ALLOWED_TELEGRAM_IDS: process.env.IDS }))' \
    > "$secrets_file"

  # The first deploy also creates the D1 database.
  deploy_log="$(npx wrangler deploy --secrets-file "$secrets_file" 2>&1 | tee /dev/stderr)"
  url="$(grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' <<<"$deploy_log" | head -1)"
  [ -n "$url" ] || { echo "Could not find the workers.dev URL in the deploy output." >&2; exit 1; }

  npm run db:migrate
  TELEGRAM_BOT_TOKEN="$token" TELEGRAM_WEBHOOK_SECRET="$secret" WORKER_URL="$url" npm run -s set-webhook

  git diff --quiet -- wrangler.jsonc 2>/dev/null \
    || echo "Note: wrangler wrote your database_id into wrangler.jsonc. It isn't needed; don't commit it (git checkout wrangler.jsonc)."
  echo
  echo "Done: $url"
  [ -n "$ids" ] || echo "Message the bot to get your Telegram ID, then: npx wrangler secret put ALLOWED_TELEGRAM_IDS"
else
  if [ -f .dev.vars ]; then
    read -rp ".dev.vars exists. Overwrite? [y/N] " overwrite
    [ "$overwrite" = y ] || { echo "Keeping .dev.vars."; npm run db:migrate:selfhost; exit 0; }
  fi
  (umask 077 && printf 'TELEGRAM_BOT_TOKEN=%s\nTELEGRAM_WEBHOOK_SECRET=%s\nALLOWED_TELEGRAM_IDS=%s\n' \
    "$token" "$secret" "$ids" > .dev.vars)
  npm run db:migrate:selfhost
  echo
  echo "Done. Start the bot with: npm run selfhost"
  [ -n "$ids" ] || echo "Message the bot to get your Telegram ID, put it into ALLOWED_TELEGRAM_IDS in .dev.vars, then restart."
fi
