# 发版门禁：冒烟测试全部通过才发布

更新检查只看正式 Release，启动不了的安装包一旦公开就会提示给所有用户升级。所以合并 Release PR 后，`release.yml` 先建 draft Release 并打 tag，再调用 `build-and-smoke.yml` 三平台构建、5 个安装包跑冒烟测试；全部成功后 `publish` 核对安装包名，上传冒烟测试用过的那份 `<platform>-build` artifact，再把 Release 转为正式。GITHUB_TOKEN 创建的 Release 不触发其它 workflow，所以构建、冒烟测试和上传只能用 `needs` 接在同一个 workflow 里。这些依赖由 `tests/releaseGate.test.cjs` 读 workflow 文件检查。

## Release PR

release-please 在 push 到 `main` 时维护 Release PR，版本号和 `CHANGELOG.md` 只由它改。`release.yml` 不对 Release PR 构建（`docs/wiki/multi-platform-testing.md`）。Release PR 由 GITHUB_TOKEN 开，会触发 `pull_request` workflow，但要维护者批准后才运行；它总会改 `package.json`，批准后 `smoke-test.yml` 测 5 个目标。合并前先批准并等这些检查通过。

## 只用 squash 合并

仓库设置只允许 squash，提交标题取 PR 标题、正文留空，进入 `main` 的只有 PR 标题。用合并提交时，release-please 会把合并提交正文里的 PR 标题和 PR 里的每个提交都收录，同一改动出现两次（`docs/wiki/release-and-update.md`）。所以 PR 标题就是 changelog 条目，`feat`、`fix`、`perf` 的标题要写用户看到的变化。

## Consequences

冒烟测试失败时 Release 停在 draft，tag 已经打了。先看失败目标的 `smoke-<目标>` artifact：

- 偶发失败（runner 故障、网络、超时抖动）：在同一次运行上点 Re-run failed jobs。release-please 的输出会保留，构建 artifact 保留 30 天，重跑通过后 `publish` 照常发布。
- 真实缺陷：这个版本号作废。删掉 draft Release 和它的 tag（`gh release delete vX.Y.Z --cleanup-tag`），用 `fix` 提交修复并合并到 `main`，发 release-please 开的下一个版本。版本号不回退。
