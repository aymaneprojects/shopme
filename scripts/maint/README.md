# Maintenance scripts

| Script | What it does |
| --- | --- |
| `verify.sh [quick\|full]` | Runs the checks and prints one line per step (`OK`/`FAIL` with test counts). `full` adds the server suites in both store modes, PostgreSQL mode when `TEST_DATABASE_URL` is set, e2e and shellcheck. |
| `merge-branch.mjs <branch> [--commit] [--verify]` | Merges a branch and resolves the usual conflicts on its own: changelog and docs lists, i18n spreads, the GraphQL operations index, and Drizzle migration numbering (backfills kept, journal timestamps kept increasing). Stops with exit 2 on anything else. |
| `pr.sh list\|show\|test\|land\|comment\|close` | Pull request workflow on top of the GitHub REST API: review a PR, test several together on `main`, land them with checks, or answer and close. |
| `release.sh [--no-exe]` | Builds every deliverable of the current commit into `dist-release/<version>-<commit>/`: server bundle and checksum, `shopme-install.sh`, one zip per bundled theme, and the Windows installer when Wine is available. |

Typical flow for incoming pull requests:

```bash
scripts/maint/pr.sh list
scripts/maint/pr.sh show 12
scripts/maint/pr.sh land 12 13        # merges, runs the quick checks, pushes
scripts/maint/release.sh               # builds the update
```
