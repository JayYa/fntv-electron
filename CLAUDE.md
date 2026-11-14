# CLAUDE.md

## Verification

After changing code, run `pnpm run check`. It runs the file size check (files changed since the merge base with `origin/main`), lint, knip and `pnpm test`, then prints a summary; it fails if any step fails. CI (`ci.yml`) runs the same command on Windows, macOS and Linux. Platform branches for macOS and Linux are verified by that CI matrix: don't assemble other platforms locally, and say in your report which branches are left to CI. Details in `TESTING_STANDARDS.md`.

Branch protection requires the `Check` job of `ci.yml` and the PR title check `Conventional Commits`. `Check` fails when any job it needs fails or is cancelled, so adding a job to `ci.yml` means adding it to the `needs` of `Check`, not to the ruleset.

## CI failures

Gather evidence before changing anything:

- `gh pr checks <pr>` or `gh run list --branch <branch> --limit 5`: find the failing run.
- `gh run view <run-id> --log-failed`: logs of the failed steps only. File size violations also show as annotations in `gh run view <run-id>`.
- `gh run view <run-id> --job <job-id> --log`: the full log of one job, e.g. to see `@electron/get` cache hits or a 504 in `Build application`.
- `gh run download <run-id> -n smoke-<target>`: screenshot and logs of a smoke test (`smoke-test.yml`). Targets come from `tests/smoke/targets.cjs`: `win32-x64`, `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`. Download into a new empty directory outside the repo.
- Installers are uploaded as `windows-build`, `macos-build` and `linux-build` by `smoke-test.yml` and `release.yml`; `ci.yml` uploads no artifacts.

## Agent skills

### Issue tracker

GitHub Issues on this fork (`JayYa/fntv-electron`), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, with their default label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
