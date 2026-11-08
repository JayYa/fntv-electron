# 多平台测试策略

相关：[发布与更新链路](release-and-update.md)

## 背景

- 2026-11-08，维护者只有 Windows 电脑，应用发布 Windows、macOS（x64、arm64）、Linux（x64、arm64）五个安装包。
- 截至 `JayYa/fntv-electron@eb90632`，PR 的 CI（`.github/workflows/ci.yml`）只在 `ubuntu-latest` 上跑 lint、Node 测试和 Go 测试。`release.yml` 在三个平台上打包，但不启动打包后的应用。
- 截至 `eb90632`，`process.platform` 的直接判断分布在 `tray.ts`、`proxy.ts`、`mainwin.ts`、`mpvConfig.ts`、`plugins/tray.ts`、`main.ts`、`fn_config/config.ts`。只有 `githubRelease.ts` 的 `expectedAssetName` 把平台作为参数传入，能在任意平台上测试所有分支。

## 2026-11-08 的决定

按投入从小到大分四层：

1. PR 的 CI 改成 Windows、macOS、Linux 三平台矩阵，跑 lint、Node 测试和 Go 测试。
2. 平台相关的决策收进接收平台参数的模块，ESLint 禁止在模块外读 `process.platform`，在 Windows 上就能测三个平台的分支。
3. 在 CI 上用 Playwright `_electron` 启动打包后的应用并截图，作为 macOS 和 Linux 的观察来源。只在 Release PR 或手动触发时跑。尚未写 spec。
4. 只能靠人验收的部分：Linux 用 WSL2 + WSLg 跑 AppImage，托盘相关的用 Hyper-V Ubuntu 桌面虚拟机；macOS 的 Gatekeeper、钥匙串、MPV 播放、菜单栏托盘需要真机，必要时按小时租云 Mac；长期考虑 prerelease 加平台验收 issue 模板，请用户回报。

用户确认先做第 1、2 层。

## GitHub Actions 额度

- 2026-11-08 用 `gh repo view` 确认仓库为公开仓库（fork）。
- 以下额度按 GitHub 规则的已知情况整理，当天没有查最新文档：公开仓库的标准机器不限分钟，macOS 也一样；Free 账户最多 20 个并发 job，其中 macOS 最多 5 个；单个 job 最长 6 小时；缓存每个仓库 10 GB；artifact 默认保留 90 天。
- 仓库转成私有后，每月只有 2000 分钟，macOS 按 10 倍计费，三平台矩阵会很快用完。

## 进展

- 2026-11-08 派出两个任务：第 1 层（CI 三平台矩阵）和第 2 层（平台分支可测化）。PR 链接和结果待补。
- 2026-11-08，第 1 层开成 PR #71（head `de5826c`）。macOS 自带 grep 不支持 `-P`，`CODING_STANDARDS.md` 里的“验证：”命令改用 `perl` 加 `\p{sc=Han}`；`configDurability` 的权限位测试在 Windows 上跳过。当天查到 `main` 没有分支保护，rulesets 为空。
- 2026-11-08，PR #71 在 `de5826c` 上首次跑三平台 CI，全部通过（`actions/runs/42445300986`）：ubuntu 43s，macos 1m5s，windows 1m45s。CI 整体耗时取决于 Windows，不是 macOS。
- 2026-11-08，第 2 层开成 PR #72（head `500c696`）。新模块 `src/public/platform.ts` 是唯一读 `process.platform` 和 `process.arch` 的地方，`platformBehavior(platform)` 汇总平台差异，`proxyExecutablePath`、`mpvUserConfigDir` 按目标平台拼路径。ESLint `no-restricted-properties` 禁止在别处读这两个属性。
- 同一任务报告了 6 个原有的平台问题（PR #72 没改，尚未核实）。2026-11-08 按用户确认建成 issue #73 至 #78，均标 `needs-triage`，对应顺序同下：
  1. Windows 上的 Proxy 路径相对于当前工作目录，工作目录不同时可能找不到；
  2. 主窗口图标在所有平台都用 `.ico`，Linux 可能加载失败；
  3. Linux 托盘没有绑定点击事件；
  4. `main.ts` 和 `plugins/tray.ts` 各有一个 `window-all-closed` 监听，逻辑互相矛盾；
  5. MPV 配置目录写死，没有读 `%APPDATA%` 和 `XDG_CONFIG_HOME`；
  6. 更新检查里有两份"平台对应哪个安装包"的逻辑。
- 2026-11-08，用户说"都做"后，agent 执行 `gh pr merge 71` 和创建 ruleset（三个 `Test (...)` 加 `Conventional Commits` 设为必需检查，管理员可绕过）都被 Claude Code auto mode 的权限检查拦下，分别归为 Merge Without Review 和 Account & Standing-Rule Changes。合并 PR 和改仓库设置要用户本人操作，或者在 Claude Code 设置里加允许规则。
- 2026-11-08，用户手动合并 #71（`a80bd69`），并启用了名为 `main` 的 ruleset。#72 rebase 到 main 后 head 为 `c51158a`，Windows 本地 lint 通过，测试 288 个：287 通过、1 个跳过、0 失败。
- 2026-11-08，#72 在 `c51158a` 上三平台 CI 和 `Conventional Commits` 共 4 项必需检查全部通过，等用户合并。第 3 层（CI 上启动打包后的应用）尚未写 spec。
