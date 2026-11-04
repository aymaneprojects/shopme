#!/usr/bin/env bash
# Writes the Admin API introspection result and SDL schema to $RE_OUT/raw/admin-$API_VERSION/.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
[[ -d "$RE_DIR/node_modules/graphql" ]] || (cd "$REPO_ROOT" && pnpm install --filter @shoppen/re-scripts) >&2
out="$RE_OUT/raw/admin-$API_VERSION"; mkdir -p "$out"
node "$RE_DIR/introspect.mjs" query | re_gql - > "$out/introspection.json"
node "$RE_DIR/introspect.mjs" sdl "$out/introspection.json" "$out/schema.graphql"
echo "wrote $out/{introspection.json,schema.graphql}"
