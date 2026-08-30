# CLAUDE.md

## Project instructions

This project is also managed by Trellis. Its instructions live in `AGENTS.md`, and the working
knowledge it points at (coding standards per layer, prior decisions, task history) lives under
`.trellis/`. Read `AGENTS.md` and the relevant files under `.trellis/spec/` before writing code.

Trellis and the agent skills below are two separate workflows. Follow one per task; don't
interleave them.

## Agent skills

### Issue tracker

GitHub Issues on this fork (`JayYa/fntv-electron`), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, with their default label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
