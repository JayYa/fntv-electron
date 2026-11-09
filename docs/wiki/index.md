# 维护 Wiki

长期维护记录。这里是历史记录，不描述代码现状：每条结论都带日期，涉及代码时带 commit。结论变化时追加新的带日期结论，并把旧结论标为已被取代：旧结论原文改为删除线，行首（删除线之前）写“已被取代（日期，见…）”，用 grep 只看到一行时最先读到的就是它。

## 决策

- [独立维护](independent-maintenance.md)：2026-11-05 决定脱离上游维护的范围和取舍，以及当天的合并和清理。
- [历史遗留 issue 分诊](legacy-issues-triage.md)：2026-11-05 至 11-07 处理 #28 至 #58 的核实结果、决定和进度，2026-11-08 核对时都已关闭。
- [平台问题分诊（#74 至 #78、#87、#94）](platform-issues-triage.md)：2026-11-08 在 `b888202` 上核实 #74 至 #78、#87、#94，七个问题都仍然存在，附核实报告给的方案和推荐顺序，维护者当天确认了顺序。当天由 PR #108、#110 至 #113 依次处理，七个 issue 都已关闭；#77 没处理的 `portable_config` 和 `~/.mpv` 两种情况另开 #114、#115。
- [平台问题分诊（#114、#115、#118、#119）](platform-issues-triage-mpv-sync.md)：2026-11-09 从上一页拆出，原文未改。当天在 `03cd5e0` 上核实 #114、#115，合成一个 PR 修复（#117）。#117 合并后维护者实测发现自选附带 MPV 时插件被清空，开 #118 由 PR #120 修复；`%APPDATA%` 下插件只剩 `.gitignore` 的现象另开 #119。#120 合并（`626a979`）后维护者实测两种自选附带 MPV 的情况都正常；同日只读核实 #119，目录完整、18:43 是安装版 2.7.1 的正常同步，复现不了。“只剩 `.gitignore`”后来查明是 chief of staff 用 `head` 截断列目录输出造成的误判；#119 以 not planned 关闭（不打 `wontfix`）。维护者决定暂不做 `pnpm setup:mpv` 和缺少 `third_party/fntv-mpv` 时的提示。截至当天，两页涉及的 issue 都已关闭。

## 子系统

- 已被取代（2026-11-08，见下方三条：更新检查的三节拆到“更新检查”，构建缓存和 MPV 记在“构建依赖与 MPV 插件同步”）：~~[发布与更新链路](release-and-update.md)：构建、MPV 配置依赖、更新检查的事实和约束，2026-11-07 起用 release-please 发版的决定和实现，v2.7.0、v2.7.1 的发版记录，以及检查更新 403 的排查。~~
- [发布与更新链路](release-and-update.md)：构建、MPV 配置依赖、更新源的事实和约束，2026-11-07 起用 release-please 发版的决定和实现，v2.7.0、v2.7.1 的发版记录，2026-11-08 Release PR 上的检查（#100）。
- [更新检查](update-check.md)：2026-11-08 从发布与更新链路拆出，原文未改。更新说明转纯文本和截断上限，检查更新 403 的排查（2026-11-07）。
- [构建依赖与 MPV 插件同步](build-dependencies.md)：2026-11-08 记录。三个平台为什么都下载 MPV 压缩包，构建下载 504 和 CI 缓存（#101），启动时插件同步到用户配置目录，README 改正（#102），打包时 Electron zip 的下载目录核实和 main 上 Windows 缓存命中验证（#104、#105）。2026-11-09 把 MPV 归档升级到 `fntv-mpv-v20261108_233327`（uosc 5.13.0、新增 thumbfast，弹幕插件不变，无破坏性变化；PR #123）。同日 CI Test job 的 Electron 下载因 504 失败，改为安装时跳过、单独步骤带缓存和重试下载（测试需要二进制，不能整个跳过）。随后 #139 的构建也因 504 失败：安装抽成 `ci.yml`、`build.yml` 共用的 composite action；打包缓存 key 改按 electron、electron-builder、app-builder-lib 版本并加 `restore-keys`；预写 `SHASUMS256.txt` 免去命中缓存时的联网校验；打包遇下载错误整体重跑；新增 `cache-warm.yml` 在 main 上为缺缓存的平台打包一次。
- [多平台测试策略](multi-platform-testing.md)：只有 Windows 电脑时怎样覆盖 macOS 和 Linux。2026-11-08 决定分四层推进，当天完成第 1、2 层（三平台 CI、平台判断集中）和第 3 层（安装包冒烟测试，spec #80），v2.7.2 是第一次过冒烟测试门禁的发版。当天决定删掉 `release.yml` 里的 Release PR 冒烟路径，改由批准后的 `smoke-test.yml` 跑。
- [依赖更新（Renovate）](dependency-updates.md)：2026-11-09 记录。Renovate pin PR #126 在 macOS、Windows 上因 `python-version` 被 pin 到 `3.11.18` 构建失败，`renovate.json` 修复（#129）并验证；#126、#127 合并；删除 `devDependencies` 里没用到的 12 个 `@types` 包，取代 #130、#131（#133）；维护者对 major 更新和 release 2.8.1 的处理决定；删除旧 TypeScript 代理留下的 5 个运行时依赖（#136）；#138、#140 合并；评估 #141（rimraf 6，可直接合并）和 #142（TypeScript 7，不能合并），维护者选择先停在 TS 6，迁移 `tsconfig.json` 并把 `typescript` 限制在 `<6.1.0`。
- [Electron 45 升级评估](electron-45-upgrade.md)：2026-11-09 只读评估 Renovate PR #134（electron 38.8.6 → 45.2.3，head `a897b3d`）。五个冒烟测试目标都只因测试正则认不出 Electron 45 自带的 `window-all-closed` 监听而失败，要先改测试；39 至 45 的 breaking changes 逐条对照（`safeStorage` 同步方法 45 弃用、46 删除，macOS 最低 13），附维护者手测清单。
