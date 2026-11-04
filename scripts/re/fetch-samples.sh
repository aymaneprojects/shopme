#!/usr/bin/env bash
# Fetches shop, products (paginated), collections, customers, orders to $RE_OUT/raw/samples/.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
out="$RE_OUT/raw/samples"; mkdir -p "$out"

check() { if jq -e '.errors' "$1" >/dev/null 2>&1; then echo "GraphQL errors in $1:" >&2; jq -c '.errors[0].message' "$1" >&2; return 1; fi; }

for name in shop collections customers orders; do
  re_gql "$RE_DIR/queries/$name.graphql" > "$out/$name.json"; check "$out/$name.json"; echo "wrote $out/$name.json"
done

after=null; page=1
while :; do
  f="$out/products-$(printf '%03d' "$page").json"
  re_gql "$RE_DIR/queries/products.graphql" "$(jq -nc --argjson a "$after" '{after:$a}')" > "$f"; check "$f"
  echo "wrote $f"
  [[ $(jq .data.products.pageInfo.hasNextPage "$f") == true ]] || break
  after=$(jq .data.products.pageInfo.endCursor "$f"); page=$((page+1)); sleep 0.5
done
