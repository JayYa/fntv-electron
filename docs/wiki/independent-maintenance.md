# 独立维护

相关：[发布与更新链路](release-and-update.md)。来源：Spec #18，工单 #19、#20、#21。

## 2026-11-05 决策

维护者决定独立维护，并确认：

- 暂不公开发版。
- fork `fntv-mpv-config` 到 `JayYa/fntv-mpv-config`（当天已创建）。
- 爱发电内容直接删除，不换成维护者的账号。
- 删除 `AGENTS.md`，不保留通用版。
- 长期知识放在随仓库公开的 `docs/wiki/`。
- 发现的标准写入 `CODING_STANDARDS.md` 和 `TESTING_STANDARDS.md`。

Chief of staff 同日作出的取舍：

- 暂不脱离 GitHub fork 网络。上游未归档，且上游 PR #158 的 head 在 `JayYa:pr/auto-mark-watched`。
- 保留原作者版权行和 GPLv3。这是工程判断，不是法律意见。
- 不改 `name`、`productName`、`appId`，也不改 `~/.fntv`、`persist:fntv`。

## 2026-11-05 事实

- 截至 `JayYa/fntv-electron@af416c0`，`README.md:234` 是仓库内唯一的项目版权行。
- 上游最后提交是 2026-08-26，最新 Release 是 v2.6.2。
- Trellis 由上游在 2026-08-26 引入，相关提交都来自上游，维护者没有使用过。

## 2026-11-05 实施结果

- 三个工单分别对应堆叠 PR #22、#23、#24，当天全部开出，等待维护者审查。
- 经验：测试此前只在 Windows 上跑过，`tests/credentialStorage.test.cjs` 的 Linux 分支在首次 CI 才暴露问题。
- 经验：`npm` 11 本地会拦截 electron postinstall，`tests/accessCodeSession.test.cjs` 本地失败属环境问题，CI 上通过。
- 经验：`.gitignore` 默认忽略 `docs/`，在 `docs/` 新增路径要先放行。

## 2026-11-05 合并与清理

- 维护者合并了 PR #24、#23、#22，改动进入 `main`（`37fc97d`）。堆叠 PR 的 `Closes` 不会自动触发，#20、#21 由 chief of staff 手动关闭。
- 维护者同意删除远端 `release` 分支及已合并的 `t3/*` 分支。agent 的删除操作被权限模式拒绝，当天未执行，由维护者处理。
