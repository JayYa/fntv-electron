---
name: delete-comment
description: Audit the code comments in a scope, move decision records into ADRs, file issues for excuses, delete them all and tighten the comment baseline.
disable-model-invocation: true
---

# Delete comments

Code carries no comments (ADR-0007). `local/no-comments` (`lint/no-comments.mjs`) holds each file to its count in `lint/comment-baseline.json`, and the baseline only goes down. This skill shrinks it one **scope** at a time: a directory or a list of files, given as the argument. Without an argument, pick the files with the highest counts in the baseline until the scope holds roughly 300 comments, and say which files you picked.

## 1. List the comments

```bash
npx eslint --rule '{"local/no-comments": ["error", {"baseline": {}}]}' -f unix <scope>
```

Each line is one comment. Read every comment in its code, not from the list alone: whether a comment repeats the code or records something the code can't show depends on the code beside it. Directives (`eslint-*`, `global`, `exported`, `@ts-*`) are not counted and stay.

## 2. Classify every comment

| Class | Test | Action |
| --- | --- | --- |
| Tautology | The code beside it already says this. | Delete. |
| Stale | It names code, versions, paths or behaviour that no longer match the repo. Check with `git grep` before calling it current. | Delete. |
| Excuse | It justifies a workaround, a known gap, hand-kept duplication, a timeout fallback, "left to review", "not handled here". | Delete, and file an issue to fix the implementation. |
| Decision record | It records a non-obvious choice, an external fact (a server's markup, an upstream tool's behaviour, an OS limit), a constraint or the reason a simpler option was rejected. | Move into an ADR, then delete. |

A comment that is both an excuse and a decision record is an excuse: the issue carries the reasoning. Done when every comment in the scope has exactly one class.

## 3. Move the decision records

Read `docs/adr/` first and add to the ADR that already covers the area (ADR-0008 lint rules, ADR-0009 `scripts/`, ADR-0010 preload and login page, ADR-0011 platform facts); start a new numbered ADR only for an area none covers. Follow the existing ADR style: `status` frontmatter, Chinese prose, file names and identifiers in inline code, issue numbers kept. Group by topic, not by source file, and drop what is now a tautology once it sits next to related facts. If an ADR contradicts the comment, surface the conflict instead of picking one. Done when every decision record's content is findable in an ADR.

## 4. File the excuses

One issue per hacky implementation (several comments about the same workaround share an issue), on `JayYa/fntv-electron` as in `docs/agents/issue-tracker.md`, labelled `needs-triage`. The body names the files and functions, quotes the deleted comment, and says what a proper fix would remove. `gh` often times out here: before retrying a failed create, check with `gh issue list --search "<title>"`.

## 5. Delete and tighten

```bash
npx eslint --fix --rule '{"local/no-comments": ["error", {"baseline": {}, "autofix": true}]}' <scope>
pnpm run comments:baseline
```

The fix removes every comment in the scope, the line it sat on, and one blank line where the comment had blank lines on both sides. Read the diff: a comment that was the only content of a block now leaves an empty block, and `no-empty` will flag it; rewrite that code rather than restoring the comment. `comments:baseline` refuses to run when any file gained comments.

## 6. Verify and report

Run `pnpm run check` (see `CLAUDE.md`). Report the counts per class, the ADRs touched, the issue links, and the baseline before and after (`comments:baseline` prints the total).
