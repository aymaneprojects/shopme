#!/usr/bin/env bash
# Runs everything: token -> introspection -> samples -> themes -> storefront capture (if present).
set -euo pipefail
D="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$D/token.sh"
bash "$D/introspect.sh"
bash "$D/fetch-samples.sh"
bash "$D/dump-theme.sh" --all
if [[ -f "$D/capture-storefront.mjs" ]]; then node "$D/capture-storefront.mjs"; fi
echo "done. Output is in ${RE_OUT:-$HOME/shoppen-re} (outside the repo; keep it private)."
