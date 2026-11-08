#!/usr/bin/env bash
# One-time production setup for QR Studio on Vercel. RUN THIS YOURSELF — it handles secrets.
#   - reuses the research site's Redis URL (read-only pull; research project is not modified)
#   - generates AUTH_SECRET/CRON_SECRET; requires encryption keys already saved independently
#   - optionally creates the private backup repo and sets the remaining variables
# Requirements: vercel CLI (logged in), gh CLI (logged in), openssl. Secrets are piped over stdin, never printed.
set -euo pipefail
umask 077

OWNER_EMAIL="${OWNER_EMAIL:?export OWNER_EMAIL=<the Google account that may sign in>}"
APP_URL="${APP_URL:-https://qr.zeyuyaoy.com}"
BACKUP_REPO="${BACKUP_REPO:-zeyuyaoy/qr-backups}"
DATA_ENCRYPTION_KEY="${DATA_ENCRYPTION_KEY:?generate and save a 32-byte base64 key in your password manager first}"
BACKUP_ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:?generate and save a DIFFERENT 32-byte base64 key in your password manager first}"
cd "$(dirname "$0")/.."
[ -f .vercel/project.json ] || vercel link --yes --project qr

add() { printf %s "$2" | vercel env add "$1" production >/dev/null && echo "set $1"; }

# 1. Redis: read the URL from the research project into memory only.
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
( cd "$tmp" && vercel link --yes --project research >/dev/null && vercel env pull .env --environment=production --yes >/dev/null )
REDIS_URL="$(grep '^RESEARCH_REDIS_URL=' "$tmp/.env" | cut -d= -f2- | sed 's/^"//; s/"$//')"
[ -n "$REDIS_URL" ] || { echo "RESEARCH_REDIS_URL not found"; exit 1; }
case "$REDIS_URL" in redis://*) echo "note: Redis URL is not TLS (redis://) — expected on Redis Cloud Free";; esac
add REDIS_URL "$REDIS_URL"; unset REDIS_URL

# 2. Session/cron secrets and independently retained encryption keys
add NEXT_PUBLIC_APP_URL "$APP_URL"
add AUTH_SECRET "$(openssl rand -base64 32)"
add DATA_ENCRYPTION_KEY "$DATA_ENCRYPTION_KEY"
add BACKUP_ENCRYPTION_KEY "$BACKUP_ENCRYPTION_KEY"
add CRON_SECRET "$(openssl rand -hex 24)"
add OWNER_EMAILS "$OWNER_EMAIL"

# 3. Google OAuth (create at https://console.cloud.google.com/apis/credentials; redirect URI: $APP_URL/api/auth/callback/google)
read -rp "Google OAuth client ID: " gid; add AUTH_GOOGLE_ID "$gid"
read -rsp "Google OAuth client secret: " gsec; echo; add AUTH_GOOGLE_SECRET "$gsec"

# 4. Backups: private repo + fine-grained token (Contents: read/write on ONLY this repo)
gh repo view "$BACKUP_REPO" >/dev/null 2>&1 || gh repo create "$BACKUP_REPO" --private --add-readme --description "Encrypted QR Studio snapshots (AES-256-GCM)"
add BACKUP_GITHUB_REPO "$BACKUP_REPO"; add BACKUP_GITHUB_BRANCH main
echo "Create a fine-grained token at https://github.com/settings/personal-access-tokens/new (repo: $BACKUP_REPO, Contents: Read and write)"
read -rsp "Backup GitHub token: " tok; echo; add BACKUP_GITHUB_TOKEN "$tok"

echo "Done. Next: vercel deploy --prod, then: vercel domains add ${APP_URL#https://} qr"
