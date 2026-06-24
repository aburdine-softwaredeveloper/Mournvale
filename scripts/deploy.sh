#!/usr/bin/env bash
#
# deploy.sh — One command to deploy OR update Mournvale (self-hosted, PM2).
#
# Player saves live in ./saves and are NEVER touched by this script — it only
# rebuilds the client and gracefully reloads the server. Run it again after a
# `git pull` to ship an update; in-progress saves and load slots are preserved.
#
#   one-time:  npm install -g pm2  &&  pm2 startup   (run the line it prints)
#   deploy:    ./scripts/deploy.sh
#   update:    git pull && ./scripts/deploy.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."   # project root

echo "→ Installing dependencies (npm ci)…"
npm ci

echo "→ Building client → dist/client…"
npm run build

if ! command -v pm2 >/dev/null 2>&1; then
  echo
  echo "PM2 isn't installed. Install it once, then re-run this script:"
  echo "    npm install -g pm2"
  echo
  echo "(Or run 'npm start' to launch in the foreground for a quick test.)"
  exit 1
fi

echo "→ (Re)starting server via PM2 — graceful reload, saves untouched…"
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save   # persist the process list so it survives a reboot

PORT_SHOWN="${PORT:-3000}"
echo
echo "✓ Mournvale is live on http://localhost:${PORT_SHOWN}"
echo "  Share http://<this-host>:${PORT_SHOWN} (LAN IP, tunnel, or domain)."
echo "  Saves are preserved in ./saves and are never modified by deploys."
echo "  Logs:  pm2 logs mournvale     Status:  pm2 status"
