#!/usr/bin/env bash
# Upload secrets from .env to the Worker. Values are piped, never printed.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "no .env (copy .env.example)"; exit 1; }
get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | tr -d '[:space:]"'"'"; }
names="IG_ACCESS_TOKEN IG_APP_SECRET AUTODM_VERIFY_TOKEN ADMIN_PASSWORD $(grep -oE '^IG_ACCESS_TOKEN_[A-Z0-9_]+' .env || true)"
for n in $names; do
  v=$(get "$n")
  if [ -z "$v" ]; then echo "skip $n (empty)"; continue; fi
  printf %s "$v" | npx wrangler secret put "$n" >/dev/null && echo "ok $n"
done
