#!/usr/bin/env bash
# Usage: gql.sh <query-file|-> [variables-json]   -> prints the JSON response
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
[[ $# -ge 1 ]] || { echo "usage: gql.sh <query-file|-> [variables-json]" >&2; exit 2; }
re_gql "$1" "${2:-}"
