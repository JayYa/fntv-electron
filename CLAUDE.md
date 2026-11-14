# CLAUDE.md

## Verification

After changing code, run `pnpm run check`. It runs the file size check (files changed since the merge base with `origin/main`), lint, knip and `pnpm test`, then prints a summary; it fails if any step fails. CI (`ci.yml`) runs the same command on Windows, macOS and Linux. Platform branches for macOS and Linux are verified by that CI matrix: don't assemble other platforms locally, and say in your report which branches are left to CI. Details in `TESTING_STANDARDS.md`.

After `pnpm run check`, each `ci.yml` cell also launches the unpackaged app (`electron .`, step `Launch unpackaged app`) and runs the installer smoke assertions against it, skipping the few that only hold for an installer. On Windows run the same check locally with `pnpm run test:smoke:unpackaged` (compiles first, about 35 seconds, opens a window); output goes to `smoke-artifacts/unpackaged-win32-x64/`. Run it when a change touches startup, the main window, the login page, preload or the Proxy.

Branch protection requires the `Check` job of `ci.yml` and the PR title check `Conventional Commits`. `Check` fails when any job it needs fails or is cancelled, so adding a job to `ci.yml` means adding it to the `needs` of `Check`, not to the ruleset.

## PR titles and release

PRs are squash-merged and the PR title becomes the commit on `main`; release-please turns `feat`, `fix` and `perf` titles into a version bump and a user-visible CHANGELOG entry. Changes to CI, the build and tests don't go into a release: title them `ci:`, `build:`, `test:` or `chore:` (hidden in `release-please-config.json`), never `feat`/`fix`/`perf`. `scripts/check-commit-message.cjs` (commit-msg hook and `pr-title.yml`) rejects `feat`, `fix` and `perf` with the scope `ci`, `build`, `test` or `tests`; it can't catch an unscoped `feat:` for a CI change, so pick the type by what users get. `fix(deps)` stays allowed: Renovate uses it for runtime dependencies, which ship in the installer.

If a CI change was already merged with a release type, add a `BEGIN_COMMIT_OVERRIDE` / `END_COMMIT_OVERRIDE` block with the corrected title to the end of the merged PR's description, then re-run the latest `release.yml` push run on `main`. release-please doesn't close a Release PR that it no longer needs: close it and remove its `autorelease: pending` label.

## CI failures

Gather evidence before changing anything:

- `gh pr checks <pr>` or `gh run list --branch <branch> --limit 5`: find the failing run.
- `gh run view <run-id> --log-failed`: logs of the failed steps only. File size violations also show as annotations in `gh run view <run-id>`.
- `gh run view <run-id> --job <job-id> --log`: the full log of one job, e.g. to see `@electron/get` cache hits or a 504 in `Build application`.
- `gh run download <run-id> -n smoke-<target>`: screenshot and logs of a smoke test (`smoke-test.yml`). Targets come from `tests/smoke/targets.cjs`: `win32-x64`, `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`. Download into a new empty directory outside the repo.
- `gh run download <run-id> -n unpackaged-<os>`: screenshot, `main-process.log`, `logs/app.log` and `proxy.log` of a failed `Launch unpackaged app` in `ci.yml`, uploaded only on failure: `unpackaged-Linux`, `unpackaged-Windows`, `unpackaged-macOS`.
- Installers are uploaded as `windows-build`, `macos-build` and `linux-build` by `smoke-test.yml` and `release.yml`; `ci.yml` uploads no installers.

## Agent skills

### Issue tracker

GitHub Issues on this fork (`JayYa/fntv-electron`), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, with their default label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
