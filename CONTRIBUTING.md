# Contributing to Shoppen

Thanks for helping! Shoppen is pre-alpha; the structure will move quickly.

## Setup

```bash
corepack enable
pnpm install
pnpm typecheck
```

Requires Node 22 (see `.nvmrc`) and pnpm 9.

## Workflow

1. Open an issue (or comment on one) before large changes.
2. Branch from `main`, keep PRs focused, and make sure `pnpm lint typecheck test build` pass.
3. Describe what changed and why in the PR.

## Clean-room rule (important)

Shoppen reproduces *behavior*, not third-party code. Read [docs/legal/clean-room.md](docs/legal/clean-room.md)
before contributing. In short: never paste proprietary code, theme files, schema dumps, or documentation text
into issues, PRs, or the repo, and never test against stores you do not own. PRs that violate this will be closed.

## Licensing

Contributions are licensed under the license of the package they touch: AGPL-3.0 by default;
MIT for `packages/theme-default`, `packages/sdk`, and `packages/ui`.
By contributing you confirm you have the right to submit your work under that license.

## Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
