---
status: accepted
---

# 代码里不写注释

注释和代码分开演化：代码改了注释没改就成了过时信息，复述代码的注释只增加阅读量，给权宜写法辩解的注释让它在仓库里被照抄。所以代码里不写注释，能从代码看出的不写，看不出的放进命名、测试或 ADR。

## 规则

- `lint/no-comments.mjs`（`local/no-comments`）对 lint 范围内的 JS/TS 文件（`package.json` 的 `lint` 脚本：`src`、`resource/login`、`tests`、`scripts`、`lint`、`eslint.config.mjs`）的每条注释报错。
- 不算注释的指令：`eslint-*`、`global`、`globals`、`exported`（登录页经典脚本跨文件共享名字靠它，见 `CODING_STANDARDS.md`）、`@ts-*` 和 shebang。
- 想写注释时按它的内容处理：

| 类别 | 含义 | 处理 |
| --- | --- | --- |
| 复述（Tautology） | 代码本身已经说明的 | 不写 |
| 辩解（Excuse） | 为权宜的实现开脱 | 不写，开 issue 修实现 |
| 决策记录（Decision Record） | 重要、从代码看不出的决定 | 写进 `docs/adr/` |

## Considered Options

- **一次删光**：放弃。2124 条注释里有大量决策记录，逐条迁进 ADR 要分几轮做，一次做完的 PR 审不过来。
- **只禁新文件的注释**：放弃。老文件里新加的注释拦不住。
- **基线记总数**：放弃。一个文件删了注释、另一个文件加了注释时总数不变，查不出来。按文件计数。

## Consequences

- 迁移期间规则按 `lint/comment-baseline.json` 给每个文件的条数放行，基线只降不升，由 `scripts/update-comment-baseline.cjs` 收紧，`/delete-comment` skill 分批把注释分类、迁进 ADR-0008 到 ADR-0011 和其他 ADR 后删掉。2026-11-24 基线降到 0 后，基线文件、脚本、skill 和规则的 `autofix` 选项一起删掉，规则改成直接禁止注释。
- YAML、shell 和 Markdown 里的注释不在这条规则范围内。
