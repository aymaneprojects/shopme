#!/usr/bin/env bash
# Obtains (or reuses) an Admin API token and caches it in $RE_OUT/.token.json. Never prints the token.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
re_ensure_token
echo "token ready (cached at $TOKEN_FILE)"
