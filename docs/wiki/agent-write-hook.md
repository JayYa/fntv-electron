# 写文件 hook

相关：[Proxy 改用 TypeScript](proxy-ts-migration.md)（hook 的起因见该页“复盘 #160、#164 实现会话”一节）。

hook 和用户全局 CLAUDE.md 都是维护者的个人配置，不在仓库里。本页只记录它们和这个仓库的代理会话有关的部分。

## 2026-11-10 加上 hook

- 起因：#160、#164 的实现会话反复用 heredoc 或 node 替换脚本改源码，并且反复出错；全局 CLAUDE.md 里“用 Write、Edit”的约定没有起作用。
- 维护者同意后，chief of staff 新增 `~/.claude/hooks/block-shell-source-writes.cjs`，在 `~/.claude/settings.json` 里登记为 Bash、PowerShell 的 PreToolUse hook。
- 第一版规则：
  - 拦截用重定向、`tee`、PowerShell 写入 cmdlet 或 `writeFileSync` 写 `src/`、`tests/` 下的文件。
  - 单行 `sed -i` 放行。
- 写 hook 时发现：经 Bash 工具传入的 heredoc 会把两个反斜杠压成一个，带引号的 heredoc 也一样。

## 2026-11-10 复盘和调整

- 只读 subagent 复盘了 hook 加上前后的会话：
  - 加 hook 前，#160、#164、cleanup 这三个会话用脚本或 heredoc 写源码约 24 次；加 hook 后，#165 和审查修复这两个会话是 0 次。用 Write、Edit 的次数从 20 增加到 57。
  - 一共拦截 2 次，其中 1 次是误拦：#165 的 node 脚本改的是 CI 配置，只是脚本内容里出现了 `src/` 字样。
  - 副作用：因为提示里写着“单行替换可以用 sed -i”，约 15 次多行改动改用了 sed（按行号删除、用 `\n` 插入）。
- 维护者同意复盘提的 1 至 4 条，不做第 5 条（hook 日志）。chief of staff 当天改了 hook：
  - `sed -i` 改 `src/`、`tests/` 时，只放行按内容匹配的单行 `s` 替换。
  - 新增拦截 python 写文件、`perl -i`、`cp`/`mv` 覆盖、`git apply`/`patch`。
  - node、python 脚本写仓库内的任何文件都拦，只放行只写临时目录的脚本。
  - 提示改为只说正确做法，并写明命中了哪条规则。
- 改完后，往 wiki 追加的 heredoc 正文里提到了 `perl -i`，被当成命令误拦。chief of staff 随即修正：不交给解释器执行的 heredoc，正文不参与检查。修正后 37 条用例本地全部通过，用例在 `%TEMP%\hook-cases\run.cjs`。
- 同日修改用户全局 CLAUDE.md：
  - 多行 node 脚本先用 Write 写到临时目录再执行（原因是上面说的反斜杠问题）。
  - `sed` 只按内容匹配、只改一行。
  - 加了一句说明有这个 hook。
- 同日发现，反斜杠问题已经污染了 wiki：`proxy-ts-migration.md` 里一句话本来写的是两个反斜杠，提交后只剩一个（提交 `3de0d96`）。已在这次拆页时改正。
