#!/usr/bin/env bash
# Shared helpers for the reverse-engineering scripts. Source this file; do not run it.
# Use ONLY with your own development store. Never prints the access token.

RE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$RE_DIR/../.." && pwd)"

for bin in curl jq node; do
  command -v "$bin" >/dev/null 2>&1 || { echo "missing required tool: $bin" >&2; exit 1; }
done

ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a; . "$ENV_FILE"; set +a
else
  echo "env file not found: $ENV_FILE (copy .env.example to .env and fill it in)" >&2; exit 1
fi

for v in SHOPIFY_SHOP SHOPIFY_CLIENT_ID SHOPIFY_CLIENT_SECRET; do
  [[ -n "${!v:-}" ]] || { echo "$v is not set in $ENV_FILE" >&2; exit 1; }
done

# Accept "name" or "name.myshopify.com" (also strips scheme and trailing slash).
SHOP="${SHOPIFY_SHOP#http://}"; SHOP="${SHOP#https://}"; SHOP="${SHOP%%/*}"; SHOP="${SHOP%.myshopify.com}"
SHOP_HOST="${SHOP}.myshopify.com"
API_VERSION="${API_VERSION:-2026-10}"

RE_OUT="${RE_OUT:-$HOME/shoppen-re}"
mkdir -p "$RE_OUT"
RE_OUT="$(cd "$RE_OUT" && pwd -P)"
# Refuse to write captured data inside the git repository.
case "$RE_OUT/" in
  "$REPO_ROOT"/*) echo "RE_OUT ($RE_OUT) is inside the repository; choose a directory outside it." >&2; exit 1;;
esac
if git -C "$RE_OUT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "RE_OUT ($RE_OUT) is inside a git work tree; choose a directory outside any repository." >&2; exit 1
fi
TOKEN_FILE="$RE_OUT/.token.json"

# Ensure a valid Admin API token is cached (refresh 10 minutes before expiry).
re_ensure_token() {
  local now; now=$(date +%s)
  if [[ -f "$TOKEN_FILE" ]] && (( $(jq -r '.obtained_at + .expires_in - 600' "$TOKEN_FILE" 2>/dev/null || echo 0) > now )); then
    return 0
  fi
  umask 077
  local resp code body
  resp=$(curl -sS --max-time 30 -X POST "https://${SHOP_HOST}/admin/oauth/access_token" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode grant_type=client_credentials \
    --data-urlencode "client_id=${SHOPIFY_CLIENT_ID}" \
    --data-urlencode "client_secret=${SHOPIFY_CLIENT_SECRET}" -w '\n%{http_code}')
  code=$(tail -n1 <<<"$resp"); body=$(sed '$d' <<<"$resp")
  if [[ "$code" != 200 ]] || ! jq -e .access_token >/dev/null 2>&1 <<<"$body"; then
    echo "token request failed: HTTP $code" >&2
    jq 'del(.access_token)' <<<"$body" 2>/dev/null >&2 || head -c 500 <<<"$body" >&2
    return 1
  fi
  jq --argjson t "$now" '. + {obtained_at: $t}' <<<"$body" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
}

# re_gql <query-file|-> [variables-json]  -> JSON response on stdout
re_gql() {
  re_ensure_token || return 1
  local token q vars
  token=$(jq -r .access_token "$TOKEN_FILE")
  q=$(cat "${1:--}"); vars="${2:-}"; [[ -n "$vars" ]] || vars='{}'
  jq -n --arg q "$q" --argjson v "$vars" '{query:$q, variables:$v}' | \
    curl -sS --max-time 120 -X POST "https://${SHOP_HOST}/admin/api/${API_VERSION}/graphql.json" \
      -H "X-Shopify-Access-Token: ${token}" -H 'Content-Type: application/json' --data-binary @-
}
