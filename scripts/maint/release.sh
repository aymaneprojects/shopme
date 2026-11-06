#!/usr/bin/env bash
# Builds every deliverable of the current commit into dist-release/<version>-<commit>/:
#   server bundle (+ .sha256), shopme-install.sh, one zip per bundled theme, and the Windows installer when Wine is available.
#   scripts/maint/release.sh [--no-exe]
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd); cd "$ROOT"
VER=$(node -p "require('./apps/server/package.json').version"); SHA=$(git rev-parse --short HEAD)
OUT="$ROOT/dist-release/$VER-$SHA"; rm -rf "$OUT"; mkdir -p "$OUT/themes"
[ -n "$(git status --porcelain)" ] && echo "warning: uncommitted changes are included in the build" >&2
pnpm install --frozen-lockfile >/dev/null
pnpm build >/dev/null
rm -rf dist-bundle && node scripts/make-server-bundle.mjs >/dev/null
cp dist-bundle/shopme-server-*.tar.gz "$OUT/shopme-server-$VER-$SHA.tar.gz"
(cd "$OUT" && sha256sum "shopme-server-$VER-$SHA.tar.gz" > "shopme-server-$VER-$SHA.tar.gz.sha256")
cp shopme-install.sh "$OUT/"
node scripts/theme-zip.mjs --out "$OUT/themes" >/dev/null
if [ "${1:-}" != "--no-exe" ] && command -v wine >/dev/null; then
  (cd apps/desktop && pnpm stage >/dev/null && rm -f dist/*.exe && WINEDEBUG=-all npx electron-builder --win --x64 >/dev/null)
  cp apps/desktop/dist/*.exe "$OUT/ShopMe-Setup-$VER-$SHA.exe"
  (cd "$OUT" && zip -qj "ShopMe-Windows-$VER-$SHA.zip" "ShopMe-Setup-$VER-$SHA.exe")
fi
ls -lh "$OUT" "$OUT/themes"
echo "$OUT"
