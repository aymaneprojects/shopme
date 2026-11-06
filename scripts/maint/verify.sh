#!/usr/bin/env bash
# Runs the project checks and prints one summary line per step.
#   scripts/maint/verify.sh          quick: install, typecheck, build, GraphQL ops, core/admin/cli/liquid tests
#   scripts/maint/verify.sh full     + server tests (single and multi-store), PostgreSQL mode if TEST_DATABASE_URL is set, e2e, shellcheck
# Logs go to .verify-logs/ (git-ignored). Exit code 1 if any step fails.
set -uo pipefail
MODE=${1:-quick}
ROOT=$(cd "$(dirname "$0")/../.." && pwd); cd "$ROOT" || exit 1
LOG=${VERIFY_LOG_DIR:-$ROOT/.verify-logs}; mkdir -p "$LOG"; FAIL=0
step() {
  local name=$1; shift
  if "$@" >"$LOG/$name.log" 2>&1; then
    echo "OK   $name $(grep -hoE 'Tests +[0-9]+ passed[^)]*\)|Tasks: +[0-9]+ successful, [0-9]+ total|[0-9]+/[0-9]+ operations valid|E2E PASSED' "$LOG/$name.log" | tail -1)"
  else echo "FAIL $name (see $LOG/$name.log)"; FAIL=1; fi
}
step install pnpm install --frozen-lockfile
step typecheck pnpm typecheck
step build pnpm build
step graphql pnpm --filter @shopme/admin validate:graphql
step core bash -c 'cd packages/core && npx vitest run'
step admin bash -c 'cd apps/admin && npx vitest run'
step cli bash -c 'cd packages/cli && npx vitest run'
step liquid bash -c 'cd packages/liquid-compat && npx vitest run'
if [ "$MODE" = full ]; then
  step server bash -c 'cd apps/server && npx vitest run --maxWorkers=2'
  step server-multi pnpm --filter @shopme/server test:multi
  if [ -n "${TEST_DATABASE_URL:-}" ]; then step postgres pnpm test:pg; fi
  step e2e pnpm e2e
  git checkout -- docs/assets/screenshots 2>/dev/null || true
  if command -v shellcheck >/dev/null; then step shellcheck shellcheck -x shopme-install.sh; fi
fi
exit $FAIL
