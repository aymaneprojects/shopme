#!/usr/bin/env bash
# Usage: dump-theme.sh [theme-gid|--all]   (default: --all)
# Downloads theme files to $RE_OUT/raw/theme/<name>/. Private data: keep it out of the repository.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

dump_one() {
  local id="$1" after=null n=0 page name out
  page=$(mktemp); trap 'rm -f "$page"' RETURN
  while :; do
    re_gql "$RE_DIR/queries/themefiles.graphql" "$(jq -nc --arg id "$id" --argjson a "$after" '{id:$id, after:$a}')" > "$page"
    if jq -e '.errors' "$page" >/dev/null; then jq -c '.errors[0].message' "$page" >&2; return 1; fi
    name=$(jq -r '.data.theme.name | gsub("[^A-Za-z0-9._-]+"; "-")' "$page")
    out="$RE_OUT/raw/theme/$name"; mkdir -p "$out"
    jq -c '.data.theme.files.nodes[]' "$page" | while IFS= read -r f; do
      fn=$(jq -r .filename <<<"$f")
      case "$fn" in /*|*..*) echo "skipping suspicious path: $fn" >&2; continue;; esac
      mkdir -p "$out/$(dirname "$fn")"
      case "$(jq -r .body.__typename <<<"$f")" in
        OnlineStoreThemeFileBodyText) jq -j .body.content <<<"$f" > "$out/$fn";;
        OnlineStoreThemeFileBodyBase64) jq -r .body.contentBase64 <<<"$f" | base64 -d > "$out/$fn";;
        OnlineStoreThemeFileBodyUrl) curl -sS --max-time 60 -o "$out/$fn" "$(jq -r .body.url <<<"$f")";;
      esac
    done
    n=$((n + $(jq '.data.theme.files.nodes | length' "$page")))
    [[ $(jq .data.theme.files.pageInfo.hasNextPage "$page") == true ]] || break
    after=$(jq .data.theme.files.pageInfo.endCursor "$page"); sleep 0.5
  done
  echo "$id -> $n files in $out"
}

target="${1:---all}"
if [[ "$target" == "--all" ]]; then
  ids=$(re_gql "$RE_DIR/queries/themes.graphql" | jq -r '.data.themes.nodes[].id')
  [[ -n "$ids" ]] || { echo "no themes found (check read_themes scope)" >&2; exit 1; }
  while IFS= read -r id; do dump_one "$id"; done <<<"$ids"
else
  dump_one "$target"
fi
