# 发布与更新链路

相关：[独立维护](independent-maintenance.md)。

## 2026-11-05 事实（`JayYa/fntv-electron@af416c0`）

- 更新检查是自写的，只提示并打开下载链接，不自动安装。更新源写死 `QiaoKes/fntv-electron`，且读 GitHub `releases/latest`，不包含 prerelease 和 draft。（更新源部分已被下方 2026-11-05 PR #24 记录取代）
- `JayYa/fntv-electron` 没有 Release、tag、secret，也从未跑过 workflow。（“从未跑过 workflow”已被下方记录取代）
- 已安装的上游版本不会迁移到本仓库的更新源。
- 下载代理默认开启，链接经 `ghfast.top` 中转。（已被下方 2026-11-07 记录取代）
- Linux x64 产物名含 `x86_64`，而更新匹配只认 `x64`。（已被下方记录取代）
- 安装包没有代码签名。

## 2026-11-05 事实（GitHub）

- GitHub fork 不带 Release。`JayYa/fntv-mpv-config` 刚 fork 时只有 tag，构建需要的 zip 资产要单独镜像。（镜像已完成，见下方记录）
- 上游 `fntv-mpv-config` 最新 Release 是 `fntv-mpv-v20260826_013404`。

## 2026-11-05 待评估（首次公开发版前）

- 版本号必须高于 2.6.2，tag 必须是合法 semver。（已解决，见下方 2026-11-07 记录）
- 重新评估 `ghfast.top` 默认代理和未签名安装包。（已解决，见下方 2026-11-07 记录）

## 2026-11-05 PR #24 记录（`JayYa/fntv-electron@f71ea84`，尚未合并）

- 更新源收敛为 `UPDATE_REPOSITORY`，指向 `JayYa/fntv-electron`。404 视为暂无更新。Linux x64 同时匹配 `x64` 和 `x86_64`。
- Release Build 只能手动触发，不创建 Release，产物留在 Actions artifacts。（已被下方 2026-11-07 记录取代）
- `JayYa/fntv-mpv-config` 已建 `fntv-mpv-v20260826_013404` 镜像 Release，构建固定 tag 并校验 sha256。
- `package.json` 加 `repository` 后，electron-builder 在 CI 上会隐式发布。打包脚本因此都带 `--publish never`。
- Release Build 首次成功运行：`actions/runs/41963636062`（head `c78c9de`）。

## 2026-11-05 待办

- 三个 PR 合并后，`release` 分支上的旧 workflow 仍可能被 push 触发（未实测），且它带 `contents: write` 和 `GH_TOKEN`。需要维护者决定快进或删除该分支。（已解决：2026-11-07 维护者确认 `release` 分支已删除）

## 2026-11-07 决定（维护者，issue #32）

- 公开发版，用 release-please。发版节奏由维护者决定，攒一批改动再合并 Release PR。
- 下一个版本 2.7.0，tag 格式 `v2.7.0`。
- `ghfast.top` 下载代理默认关闭。
- 不购买签名证书，在 `README.md` 写明 SmartScreen 和 Gatekeeper 提示及绕过方法。
- 图标继续使用。
- `release` 分支已删除。

## 2026-11-07 实现记录（PR 分支 `t3/release-please-release-flow`，尚未合并）

- `release.yml`（`a18033e`）：push 到 `main` 时跑 release-please（`googleapis/release-please-action` v5.0.0，内含 release-please 17.6）。配置在 `release-please-config.json`：`draft: true` 加 `force-tag-creation: true`，合并 Release PR 后先建 draft Release 并立即打 tag。同一 workflow 里 `select-matrix`、`build` 用 `needs` 和 `release_created` 接在后面，`publish` 等三平台构建都成功后核对 5 个安装包名，`gh release upload` 上传 exe、dmg、AppImage 和 blockmap，最后 `gh release edit --draft=false --latest`。写权限只给 `release-please` 和 `publish` 两个 job。手动触发仍只构建。
- 版本起点：`.release-please-manifest.json` 写 2.6.2，`bootstrap-sha` 是上游 v2.6.2 发版说明提交 `0c4ed46`。没有用 `release-as`，它要在发版后手动删掉，否则下一版还是 2.7.0。2026-11-07 对 PR 分支跑 `release-please release-pr --dry-run`，结果是 2.6.2 → 2.7.0。之后如有带 `!` 的提交合进 `main`，版本会变成 3.0.0，合并 Release PR 前看一眼标题。
- `CHANGELOG.md` 原有内容保留，标题改成 `## 2.6.2 (2026-08-26)`。原来没有符合 release-please 版本标题格式的行，它会在顶部加 `# Changelog` 并把原有一级标题降级。
- changelog 分区：`feat` 进“新功能”，`fix` 进“问题修复”，`perf` 进“性能优化”，其余类型隐藏。
- dry run 里同一改动出现两次：合并提交带 PR 标题，PR 里的提交也单独收录。release-please 没有去重选项。2.7.0 的 changelog 覆盖 `0c4ed46` 之后的全部历史，重复和偏开发者的描述已经在里面。（合并方式和 2.7.0 的修正做法已被下方 2026-11-07 合并方式记录取代）
- 更新检查核实（`ba03b4d`）：`tag_name` 去掉 `v` 后用 `semver.gt` 和 `app.getVersion()` 比较，`v2.7.0` 对 2.6.2 判为有更新，同版本和更旧版本判为无更新。安装包匹配按 2.6.2 在 `actions/runs/41963636062` 的真实产物名测试，五个平台架构都选中安装包，不会选中 blockmap。这部分不需要改代码。
- 下载代理默认关闭（`ac6a39a`）：`getDownloadProxyConfig` 只有 `downloadProxyEnabled === true` 才启用；托盘、登录页设置面板、IPC 处理器的默认值一起改。已有配置不迁移：从未保存过这个字段的用户直连 GitHub；字段为 `true` 的保持开启。旧版登录页的开关默认勾选，在设置面板点过“保存”（哪怕只改播放方式）就会写入 `true`，这部分用户无法和主动开启的用户区分。
- 提交规范（`b7a7515`）：`.githooks/commit-msg` 和 `pr-title.yml` 共用 `scripts/check-commit-message.cjs`，CI 检查 PR 标题和 PR 里每个非合并提交的标题。（CI 检查范围已被下方 2026-11-07 合并方式记录取代）
- `CODING_STANDARDS.md` 写明发版流程，以及提交描述会进入用户可见的 changelog（`e98650e`）；`README.md` 写明下载方式和未签名安装包的打开方法（`dbe6adf`）。

## 2026-11-07 决定（维护者）

- 保留 `CHANGELOG.md`，release-please 继续在原有内容上方追加新版本。

## 2026-11-07 实现记录（PR #62 分支，`51c60a8`，尚未合并）

- 更新提示框的正文原来直接显示 Release 的 Markdown，release-please 生成的版本标题行、`**scope:**`、提交哈希和 PR 链接都按原始文本显示。现在由 `src/modules/updater/releaseNotes.ts` 的 `formatReleaseNotes` 转成纯文本：去掉版本标题行，分组标题只留文字（如“新功能”），列表项以 `• ` 开头，去掉条目末尾的提交和 PR 括注以及 `, closes #N`，其它链接只留链接文字，去掉 `**` 和反引号，合并多余空行。
- 原生对话框不能滚动，原来没有长度限制。现在超过 15 行或 800 个字符时截断，末尾提示点“查看详情”打开 Release 页面。正文为空时仍显示“暂无更新说明”。
- 测试样例按 `googleapis/release-please` v17.11 的 Release 正文格式编写，分区换成本仓库的中文分区（`tests/releaseNotes.test.cjs`、`tests/updateChecker.test.cjs`）。

## 2026-11-07 事实（GitHub 设置）

- 仓库的 Actions 设置 `can_approve_pull_request_reviews` 为 `false`，即未勾选“Allow GitHub Actions to create and approve pull requests”。不勾选时 release-please 用 `GITHUB_TOKEN` 开不了 Release PR。
- `GITHUB_TOKEN` 开的 Release PR 不触发 `pull_request` workflow，CI 和 PR 标题检查都不会跑。
- `main` 没有分支保护。

## 2026-11-07 合并方式记录（PR #62 分支，`bf273e1`，尚未合并）

- 方案 A：保留合并提交，正文留空，提交里只剩 PR 标题。dry run 验证可行，每个 PR 只收录一条。GitHub 不接受 `merge_commit_title=MERGE_MESSAGE` 加 `merge_commit_message=BLANK` 的组合，返回 422 `invalid_merge_commit_setting_combo`，设置没改成，方案 A 放弃。
- 决定（维护者）：改用 squash 合并。
- 仓库设置（已改，回读确认）：`allow_squash_merge=true`、`allow_merge_commit=false`、`allow_rebase_merge=false`、`squash_merge_commit_title=PR_TITLE`、`squash_merge_commit_message=BLANK`。改之前三种合并方式都开着，squash 标题是 `COMMIT_OR_PR_TITLE`，正文是 `COMMIT_MESSAGES`。
- `pr-title.yml` 只检查 PR 标题，不再检查 PR 里的提交，它们不进 `main`。本地 `.githooks/commit-msg` 保留。`check-commit-message.cjs` 去掉了 `--range` 模式（`bf273e1`）。
- squash 后 PR #62 在 `main` 上只剩标题 `ci(release): …`，属于隐藏类型。分支里的 `fix(updater)` 提交（下载默认直连、更新说明转纯文本）不会进 changelog，要在下面的整理条目里写上。

## 2026-11-07 2.7.0 changelog 的修正做法（release-please 17.6 源码和模拟 dry run）

- 已合并 PR 正文里写 `BEGIN_COMMIT_OVERRIDE` 修不了合并提交造成的重复。`commit.js` 的 `preprocessCommitMessage` 对每个关联到该 PR 的提交都用覆盖内容，合并提交和 PR 里的提交关联的是同一个 PR，覆盖内容会出现 N+1 次。
- 合并前直接改 Release PR 的 `CHANGELOG.md` 和正文可行，但之后每次 push 到 `main` release-please 都会重新生成 Release PR，改动被覆盖，只能在合并 Release PR 前最后一刻做。
- 采用的做法：#62 squash 合并得到提交 S 后，再开一个 PR，把 `release-please-config.json` 的 `bootstrap-sha` 改成 S，PR 正文写 `BEGIN_COMMIT_OVERRIDE` … `END_COMMIT_OVERRIDE`，里面每条一个 Conventional 标题，空行分隔。squash 合并后，S 之前的历史都不算，这个 PR 的提交按覆盖内容展开成整理好的条目；S 之后合并的其它 PR 照常收录。没有正式 Release 时才看 `bootstrap-sha`，发出 2.7.0 后它不再起作用。
- 验证：用 release-please 17.6.0 的 `Manifest.buildPullRequests`，读真实的 PR 分支配置，模拟在分支头之后 squash 进一个带覆盖正文的提交，`bootstrapSha` 设为分支头。结果是 2.6.2 → 2.7.0，changelog 只有覆盖里的 3 条新功能和 6 条问题修复，没有重复。每条都链接到这个整理提交的哈希，更新提示框会去掉哈希（`releaseNotes.ts`）。
