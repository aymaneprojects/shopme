#!/usr/bin/env bash
# Pull request helper (GitHub REST API through gh).
#   scripts/maint/pr.sh list                       open PRs with size and base
#   scripts/maint/pr.sh show <n>                   body, files and code diff (docs excluded)
#   scripts/maint/pr.sh test <n> [<n>...]          merge the PRs onto main in a scratch branch and run verify.sh quick
#   scripts/maint/pr.sh land <n> [<n>...]          merge the PRs into main (conflicts resolved by merge-branch.mjs), verify, push
#   scripts/maint/pr.sh comment <n> <file>         post the file's text as a comment
#   scripts/maint/pr.sh close <n> <file>           post the file's text, then close the PR without merging
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd); cd "$ROOT"
REPO=${SHOPME_REPO:-$(git remote get-url origin | sed -E 's#.*github.com[:/]([^/]+/[^/.]+)(\.git)?$#\1#')}
cmd=${1:-list}; shift || true
fetch() { for n in "$@"; do git fetch -q origin "pull/$n/head:pr-$n" --force; done; }
case "$cmd" in
  list) gh api "repos/$REPO/pulls?state=open&per_page=100" --jq '.[] | "#\(.number)\t\(.base.ref)\t\(.head.ref)\t\(.title)"' ;;
  show) n=$1; fetch "$n"; gh api "repos/$REPO/pulls/$n" --jq '"#\(.number) \(.title)\n\n\(.body)"'; echo; git diff --stat "main...pr-$n"; git diff "main...pr-$n" -- . ':(exclude)docs' ':(exclude)*.md' ;;
  test)
    fetch "$@"; git checkout -q -B "pr-test" main
    for n in "$@"; do node scripts/maint/merge-branch.mjs "pr-$n" --commit -m "test PR #$n" || { echo "PR #$n: merge needs a human"; git merge --abort 2>/dev/null; git checkout -q main; exit 2; }; done
    scripts/maint/verify.sh quick; status=$?; git checkout -q main; git branch -q -D pr-test; exit $status ;;
  land)
    fetch "$@"; git checkout -q main; git pull -q --ff-only origin main || true
    for n in "$@"; do
      title=$(gh api "repos/$REPO/pulls/$n" --jq .title)
      node scripts/maint/merge-branch.mjs "pr-$n" --commit -m "Merge PR #$n: $title" || { echo "PR #$n: merge needs a human"; exit 2; }
    done
    scripts/maint/verify.sh quick || { echo "checks failed: nothing pushed (reset with: git reset --hard origin/main)"; exit 3; }
    git push -q origin main && echo "pushed $(git rev-parse --short HEAD)" ;;
  comment) gh api -X POST "repos/$REPO/issues/$1/comments" -F body=@"$2" --jq .html_url ;;
  close) gh api -X POST "repos/$REPO/issues/$1/comments" -F body=@"$2" --jq .html_url && gh api -X PATCH "repos/$REPO/pulls/$1" -f state=closed --jq '"#\(.number) \(.state)"' ;;
  *) sed -n '2,9p' "$0"; exit 64 ;;
esac
