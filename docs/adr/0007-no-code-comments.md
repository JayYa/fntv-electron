---
status: accepted
---

# 代码里不写注释，按基线逐步删光

注释和代码分开演化：代码改了注释没改就成了过时信息，复述代码的注释只增加阅读量，给权宜写法辩解的注释让它在仓库里被照抄。所以代码里不写注释，能从代码看出的不写，看不出的放进命名、测试或 ADR。

## 规则

- `lint/no-comments.mjs`（`local/no-comments`）对 lint 范围内的 JS/TS 文件（`package.json` 的 `lint` 脚本：`src`、`resource/login`、`tests`、`scripts`、`lint`、`eslint.config.mjs`）计数注释，超过 `lint/comment-baseline.json` 给这个文件的条数就报错，新文件的基线是 0。
- 不算注释的指令：`eslint-*`、`global`、`globals`、`exported`（登录页经典脚本跨文件共享名字靠它，见 `CODING_STANDARDS.md`）、`@ts-*` 和 shebang。
- 基线只降不升（ratchet）。文件的注释比基线少时 lint 也报错，要求运行 `pnpm run comments:baseline` 收紧；这个脚本发现哪个文件比基线多时拒绝写入。
- 删注释用仓库里的 `/delete-comment` skill（`.claude/skills/delete-comment/SKILL.md`）：按下面四类处理每条注释，再用规则的 `autofix` 选项一次删掉一个文件里的全部注释。

## 四类注释

| 类别 | 含义 | 处理 |
| --- | --- | --- |
| 复述（Tautology） | 代码本身已经说明的 | 删 |
| 过时（Stale） | 说的代码或实现已经不在了 | 删 |
| 辩解（Excuse） | 为权宜的实现开脱 | 删，另开 issue 修实现 |
| 决策记录（Decision Record） | 重要、从代码看不出的决定 | 移进 `docs/adr/` |

## Considered Options

- **一次删光**：放弃。2124 条注释里有大量决策记录，逐条迁进 ADR 要分几轮做，一次做完的 PR 审不过来。
- **只禁新文件的注释**：放弃。老文件里新加的注释拦不住。
- **基线记总数**：放弃。一个文件删了注释、另一个文件加了注释时总数不变，查不出来。按文件计数。

## Consequences

- 第一轮（引入这条规则的 PR）删光了 `eslint.config.mjs`、`scripts/`、`src/public/`、`src/preload/`、`resource/login/` 的注释，决策记录迁进 ADR-0008 到 ADR-0011；`src/main/`、`src/modules/` 和 `tests/` 留在基线里，用 `/delete-comment` 分批处理。
- YAML、shell 和 Markdown 里的注释不在这条规则范围内。
