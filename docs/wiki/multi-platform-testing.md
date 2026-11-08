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
3. 在 CI 上用 Playwright `_electron` 启动打包后的应用并截图，作为 macOS 和 Linux 的观察来源。只在 Release PR 或手动触发时跑。尚未写 spec。（“尚未写 spec”已被下方“第 3 层”取代：spec #80，由 #96 合进 main）
4. 只能靠人验收的部分：Linux 用 WSL2 + WSLg 跑 AppImage，托盘相关的用 Hyper-V Ubuntu 桌面虚拟机；macOS 的 Gatekeeper、钥匙串、MPV 播放、菜单栏托盘需要真机，必要时按小时租云 Mac；长期考虑 prerelease 加平台验收 issue 模板，请用户回报。

用户确认先做第 1、2 层。

## GitHub Actions 额度

- 2026-11-08 用 `gh repo view` 确认仓库为公开仓库（fork）。
- 以下额度按 GitHub 规则的已知情况整理，当天没有查最新文档：公开仓库的标准机器不限分钟，macOS 也一样；Free 账户最多 20 个并发 job，其中 macOS 最多 5 个；单个 job 最长 6 小时；缓存每个仓库 10 GB；artifact 默认保留 90 天。
- 仓库转成私有后，每月只有 2000 分钟，macOS 按 10 倍计费，三平台矩阵会很快用完。

## 进展

- 2026-11-08 派出两个任务：第 1 层（CI 三平台矩阵）和第 2 层（平台分支可测化）。PR 链接和结果待补。（已被下方条目取代：第 1 层是 PR #71，合并为 `a80bd69`；第 2 层是 PR #72，合并为 `2d5710d`）
- 2026-11-08，第 1 层开成 PR #71（head `de5826c`）。macOS 自带 grep 不支持 `-P`，`CODING_STANDARDS.md` 里的“验证：”命令改用 `perl` 加 `\p{sc=Han}`；`configDurability` 的权限位测试在 Windows 上跳过。当天查到 `main` 没有分支保护，rulesets 为空。（已被同日后文取代：用户启用了名为 `main` 的 ruleset）
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
- 2026-11-08，#72 在 `c51158a` 上三平台 CI 和 `Conventional Commits` 共 4 项必需检查全部通过，等用户合并。第 3 层（CI 上启动打包后的应用）尚未写 spec。（已被取代：#72 同日合并为 `2d5710d`；第 3 层写成 spec #80）
- 2026-11-08，用户手动合并 #72 和 #79。（补记：#72 为 `2d5710d`，#79 是记录本页的 wiki PR，为 `31152c3`）

## 第 3 层：安装包冒烟测试（spec #80）

（2026-11-08 补注：本节未单独注明日期的条目都是 2026-11-08 的记录。集成分支经 #96 合进 main，为 `58e82f1`。）

- 2026-11-08，用户同意以下设计，写成 spec #80，拆成 ticket #81 到 #85：
  - 把安装包当黑盒，用 Playwright `_electron` 启动；
  - 5 个目标都覆盖；
  - 做成可复用的 workflow，发版时作为门禁，Release PR 上也跑；
  - 普通 PR 不跑。
- 实现流程：集成分支 `feat/smoke-tests`。每个 ticket 开一个 PR 合进集成分支，CI 通过后由 agent 在本地 `git merge` 再 push。合并到 main 的 PR 是 #96。
- 子 PR：#86（Linux x64）、#88（macOS）、#89（Windows）、#90（Linux arm64）、#93（发版门禁）、#95（审查修复）。
- 冒烟测试顺带发现的问题：
  - #73 在 #89 中复现（Windows 上从非安装目录启动找不到 Proxy），由 #91 修复并合进 main；
  - #87：打包后日志目录不在 `~/.fntv`；
  - #94：`release.yml` 的并发设置会丢掉排队中的运行。

### 踩过的坑（2026-11-08）

- **Linux FUSE 时序（#86）**：主进程在创建主窗口期间，`app.evaluate` 必然失败。用 FUSE 运行 AppImage 时，这段约 350ms；用 extract-and-run 时约 50ms。规则：先 `await app.firstWindow()`，再 `app.evaluate`。
- **macOS x64 首次转译（#92）**：Rosetta 首次转译 x64 Electron 约需 50 秒。
  - 证据：同一台 `macos-latest` 上连续直接启动 3 次，DevTools listening 分别在 51952ms、5552ms、6733ms；`/var/db/oah` 从 2.7M 涨到 255M。
  - 修法：对 darwin-x64 先预热一次，上限 120 秒。#89 上预热实测 47 秒。
- **Windows 用户数据隔离**：`app.getPath('home')` 不读 `USERPROFILE`。改用启动参数 `--user-data-dir`，它同时也是 Chromium 的开关，见审查记录 L1。
- **Release PR 不触发 CI**：release-please 用 `GITHUB_TOKEN` 开的 PR 不会触发 `pull_request` workflow。#70 上没有任何检查。（已被下方 2026-11-08 核对补记取代：`pull_request` workflow 会触发，但状态是 `action_required`，与[发布与更新链路](release-and-update.md) v2.7.0 验收记录一致）#95 改为在 `release.yml` 同一次运行里对 Release PR 分支跑冒烟测试。
- **本地验证**：本机 WSL 里只有 docker-desktop。Linux 冒烟测试用 Docker Desktop 的 Ubuntu 24.04 容器跑，要走和 CI 一样的 FUSE 路径。arm64 的 AppImage 在 QEMU 下因为魔数问题跑不起来，改了魔数后又太慢，不值得尝试。
- **派任务的教训**：派修复任务前，先用 `gh pr view --json headRefName` 查出 PR 的实际分支。2026-11-08 有一次照着 thread 元数据写错了分支名。

### 待验证

- 2026-11-08 时，真实的发版门禁（合并 Release PR → draft → 5 个目标冒烟测试 → publish）还没跑过。#96 合并后第一次发版时要检查：
  - publish 是否等待冒烟测试；
  - Release PR 的冒烟测试是否出现在 push 到 main 的那次运行里。

## Agent 权限边界

- 2026-11-08 在 Claude Code auto mode 下：
  - 被拦下的操作：`gh pr merge`、创建 ruleset、建 draft PR 时同时 `gh workflow run`。
  - 放行的操作：普通 `gh pr create`、`gh issue create`、`gh run rerun`、push 到非 main 分支。
- 合进集成分支用的是本地 `git merge` 加 push。合进 main 一律由用户操作。（2026-11-08 的做法）

## 发版门禁首次实战（2026-11-08）

- #96 合并后，push 到 main 的那次 Release 运行（`actions/runs/42462528362`）没有跑 Release PR 冒烟测试。原因：`ci:` 提交不进 changelog，release-please 日志为 `PR #70 remained the same`，`prs_created` 为 false。符合设计，但这意味着只有 Release PR 内容变化时才会跑冒烟测试。
- 用户合并 Release PR #70 后，`actions/runs/42463066829` 发布 v2.7.2：
  - 三平台构建和 5 个目标冒烟测试全部通过，最后完成的是 darwin-x64（08:33:41Z）；
  - 之后 `Publish release` 才完成（08:33:58Z）；
  - Release 不是 draft，是 latest，8 个资产齐全（5 个安装包，加上 exe 和两个 dmg 的 blockmap）。
- 上文"待验证"中的第一条（publish 等待冒烟测试）已在这次发布中得到验证。第二条（Release PR 冒烟测试）要等下一次 Release PR 内容变化时再看。

## 2026-11-08 核对补记（wiki 检查，`JayYa/fntv-electron@ab43e4d`）

- Release PR 的检查：#70 的 CI 和 PR Title 运行在 `4d04c66` 上是 `action_required`；在 `5eab479` 上由 `JayYa` 批准，第 2 次尝试通过（`actions/runs/42455333345`，三个 `Test (...)` 和 `Conventional Commits` 均成功）。上文“#70 上没有任何检查”不准确：检查已触发，只是等待批准。#95 在 `release.yml` 里跑冒烟测试的理由（批准前 `pull_request` 运行不会自动执行）不受影响。
- issue 状态（`gh issue view`）：
  - #73 已于 2026-11-08 关闭（#91 合并为 `99ae40d`）。
  - #74 至 #78 仍为 OPEN，标签仍是 `needs-triage`，尚未分诊。
  - #87、#94 仍为 OPEN，`needs-triage`。
  - spec #80 和 ticket #81 至 #85 已于 2026-11-08 随 #96 合并关闭；#92（实验，不合入）已关闭。
- “待验证”第二条（Release PR 的冒烟测试是否出现在 push 到 main 的那次运行里）当天仍没有结果：v2.7.2 发布后没有新的 Release PR（`gh pr list --state open` 为空），之后 push 到 main 的 `actions/runs/42463841974`（`ab43e4d`，`docs` 提交）是隐藏类型，不会开 Release PR。
