# 平台问题分诊（#114、#115、#118、#119）

2026-11-09 从 [平台问题分诊（#74 至 #78、#87、#94）](platform-issues-triage.md) 拆出，原文未改，原因是原文件接近提交钩子的 20000 字节上限。

相关：[平台问题分诊（#74 至 #78、#87、#94）](platform-issues-triage.md)、[构建依赖与 MPV 插件同步](build-dependencies.md)。#114、#115 是怎么开出来的，见上一页“2026-11-08 进度（#111、#112、#113 合并后）”一节。

## 2026-11-08 核实 #114、#115

在 `origin/main` 的 `03cd5e0` 上核实，两个问题都仍然存在。依据是子代理读 mpv 源码和手册，没有实测。

- #114：
  - `media.ts:452-455`：用户自己指定 mpv 时，不传 `--config-dir`。
  - `platform.ts:107-111`：同步目标不考虑 `portable_config`。
  - `osdep/path-win.c`：mpv.exe 旁边有 `portable_config` 时，mpv 只读它，不读 `%APPDATA%/mpv`。
  - `options/path.c` 的 `mp_init_paths`：`MPV_HOME` 和 `--config-dir` 优先于 portable。
  - 推断，未实测：用户指定的是 scoop shim 时，按 `dirname(mpvPath)/portable_config` 推断会落空。
- #115：
  - `platform.ts:113-115` 没有处理 `~/.mpv`。
  - `osdep/path-unix.c:109-113` 和 `osdep/path-darwin.c`：`~/.mpv` 存在而标准目录（`$XDG_CONFIG_HOME/mpv` 或 `~/.config/mpv`）不存在时，只用 `~/.mpv`。Windows 不读 `~/.mpv`。
  - `options/configfiles.c:75`：两个目录都存在时以标准目录为准，并发出告警。
  - 影响：客户端新建标准目录会让用户 `~/.mpv` 里的配置失效。
- 维护者 2026-11-08 确认 #114、#115 合成一个 PR。两个 issue 已发核实评论，标签从 `needs-triage` 改为 `ready-for-agent`。
- 本 PR：
  - `mpvUserConfigDir(platform, dirs, env, userMpvPath, pathExists)`。顺序：`MPV_HOME`；Windows 上 `userMpvPath` 旁边有 `portable_config` 时用它，否则 `appDataDir` 下的 `mpv`；其它平台标准目录不存在而 `~/.mpv` 存在时用 `~/.mpv`，否则标准目录。
  - 存在性检查由调用方传入（`mpvConfig.ts` 传 `fs.existsSync`），函数仍是纯函数，和其它平台函数一样接收参数。
  - 同步时传配置里的用户 mpv 路径。打包 mpv 的 `--config-dir` 不传，路径不变。
  - 没处理：scoop shim；同步只在启动时进行，改 MPV 播放器路径后要重启客户端。
  - 测试在 `mkdtemp` 里建真实目录（`tests/platform.test.cjs`）。Windows 分支的三条测试要在 Windows 主机上跑，其它主机上 skip，由 CI 的 Windows job 覆盖。
  - 合并前要人工实测：Windows 上把一个旁边带 `portable_config` 的 mpv 设为用户自选 mpv，确认弹幕插件生效。

## 2026-11-08 #117 合并后实测：自选附带 MPV 时插件被清空（#118）

- 维护者合并了 PR #117（#114、#115，commit `cfef805`，squash 合并）。
- 维护者当天在 main `cfef805` 上实测，自选 MPV 设为仓库附带的 `third_party\fntv-mpv\mpv.exe`：
  - 同步目标正确，是这个 mpv.exe 旁边的 `portable_config`。
  - `%APPDATA%\mpv` 没有被这次同步改动。
  - 但 `portable_config\scripts\uosc_danmaku\` 被清空，客户端日志仍记“MPV托管插件已同步: uosc_danmaku”，mpv 日志报 `Cannot find main.* ... uosc_danmaku`。
- 根因，已在临时目录实测复现：目标和来源是同一个目录。`synchronizeMpvConfig`（`cfef805` 的 `mpvConfigHelpers.ts:72-73`）先 `rmSync` 目标插件目录，再从已被删掉的来源复制；`copyDirectoryRecursive` 先重建了空目录，读到空列表，不报错，返回 `updated`。安装版用户把自选 MPV 指向安装目录里附带的 `mpv.exe`，也会触发。
- 开了 #118（`ready-for-agent`），由 PR #120 修复：
  - 来源和目标 realpath 相同时返回 `same-directory`，跳过同步并记日志。
  - 先在用户配置根目录的 `.fntv-sync-*` 暂存目录里复制，再换掉旧插件目录。
  - 同步前后检查 `main.lua`，缺失时抛错，记 ERROR，不记“已同步”。
  - 测试在 `mkdtemp` 里建真实目录（`tests/mpvConfigMigration.test.cjs`）。
  - 合并前要人工实测：用附带的 MPV 作为自选 MPV 启动，插件目录不被清空，弹幕生效。
- 已被取代（2026-11-08，见“#119 关闭”一节）：~~另一个现象：`%APPDATA%\mpv\scripts\uosc_danmaku\` 从 2026-11-08 18:43 起只剩 `.gitignore`。原因不明，开了 #119（`needs-triage`）。~~
  - 和 #118 不是同一个问题：#118 清出的是空目录，不留 `.gitignore`（实测）。
  - 18:43 早于 #113（22:38）和 #117（23:20）合并。
  - MPV 归档里的插件是完整的 18 个文件（实测 `unzip -l`）。
  - 插件自更新只在手动触发时运行；附带的 2.1.0 已是上游最新版，不会替换目录（读代码，推断）。

## 2026-11-08 #120 合并后实测，核实 #119（待维护者确认）

- 维护者合并了 PR #120（#118，commit `626a979`，squash 合并）。
- 维护者在 #120 分支（head `dbd70ad`，worktree `t3-07352ab5`）上实测两次，chief of staff 读日志核实：
  1. 23:42，自选 MPV 是另一个目录的附带 MPV：正常同步，目标 `uosc_danmaku` 里有 `main.lua`。
  2. 23:43，自选 MPV 是这个 worktree 自己附带的 MPV：日志记“MPV配置目录就是便携配置，跳过同步”，插件完整；mpv 日志显示 `uosc_danmaku/main.lua` 正常加载，没有 `Cannot find main.*`。
  - 弹幕画面是否显示，以维护者的观察为准，日志看不出来。
- 已被取代（2026-11-08，见“#119 关闭”一节）：~~同日更早的一次实测无效：维护者在 `813e805` 的旧代码 worktree 里启动，worktree 里没有 `third_party/fntv-mpv`，启动时同步报 “Portable config directory not found”。worktree 缺 `third_party/fntv-mpv` 导致测不成，这是第二次，第一次见 #54 的冒烟测试。chief of staff 建议改进环境：加 `pnpm setup:mpv`，或者开发模式下缺失时给出明确提示。维护者尚未决定。~~

### 核实 #119（只读，2026-11-08 约 23:50，待维护者确认）

结论：插件没有被删。现在的 `%APPDATA%\mpv\scripts\uosc_danmaku\` 是完整的，issue 里说的“只剩 `.gitignore`”在本机复现不出来。

- 实测：目录里有 17 个文件（`.gitignore`、`main.lua`、`apis/` 2 个、`dicts/` 2 个、`modules/` 11 个），和 `t3-07352ab5` 里 `third_party/fntv-mpv/portable_config/scripts/uosc_danmaku` 逐个比对（`diff -rq`）完全相同。#118 一节里说的“18 个文件”是 `unzip -l` 的条目数，可能把目录条目也算进去了，没有核对。
- 实测：每个文件和子目录的创建时间都是 18:43:45，文件的修改时间都是 00:42:26（是来源文件的时间）。`uosc_danmaku` 和三个子目录的修改时间也都是 18:43:45，之后再没有增删。
- 实测（客户端日志 `%APPDATA%\fntv\logs\app.log`）：18:43:45.117 启动的是安装版 2.7.1，18:43:45.433 记“MPV托管插件已同步: uosc_danmaku”。2.7.1 的代码早于 #113，目标是 `%APPDATA%\mpv`，目标已有 `scripts`，所以删掉 `uosc_danmaku` 重新复制。18:43 就是这次正常同步，不是删除。
- 实测（`%APPDATA%\mpv\mpv.log`，最后写入 18:55:53）：mpv 带 `--config-dir=C:\Users\xiaos\AppData\Roaming\mpv` 启动，加载了 `uosc_danmaku/main.lua`，插件报版本 2.1.0，没有 `Cannot find main.*`。
- 推断：如果 18:43:45 之后目录被删到只剩 `.gitignore` 又被恢复，各个目录的修改时间会晚于 18:43:45。实际没有，所以 18:43 以后目录一直完整。
- 已被取代（2026-11-08，见“#119 关闭”一节）：~~推断：issue 里的“只剩 `.gitignore`”可能是观察出错，比如看错了目录（例如被 #118 清空的某个 worktree 里的 `portable_config`），或者用的列目录方式漏掉了文件。具体是哪种，没有查到。目录不在 git 仓库里，`.gitignore` 的规则（`danmaku/*`、`*.toml`、`.*`）不会影响 mpv 或客户端读取，也不会隐藏 `.lua` 文件（读规则，推断）。~~
- issue 里列的其它方向都可以排除：#113、#117 之前的同步代码在 18:43 正常复制了全部文件（日志和创建时间，实测）；插件自更新没有触发的记录（实测 `mpv.log` 里没有 `check-update`，但这个日志只记最后一次 18:55 的运行，18:43 到 18:55 之间是否触发过看不到；即使触发，附带的 2.1.0 已是最新版，不会替换目录，读代码，推断）；开发版启动会写 `~/.fntv/logs`，本机没有这个目录（实测），`app.log` 里 14:30 之后、23 点之前的启动只有 18:43 这一次安装版（实测）。
- 已被取代（2026-11-08，见“#119 关闭”一节）：~~修复方案：不需要改代码，规模为 0。建议在 #119 评论里写明上面的实测结果，标 `wontfix` 关闭（复现不了）。维护者如果当时看到的确实是另一个目录，可以补一句说明再关闭。~~

## 2026-11-08 #119 关闭，本页 issue 全部关闭

- “`uosc_danmaku` 只剩 `.gitignore`”是 chief of staff 的误判。当时用 `ls -la <两个目录> | head -14` 同时列两个目录，输出在第 14 行截断，`uosc_danmaku` 排在最后，只显示到 `.gitignore`。这个错误结论被写进了 #119 和 #120 的子代理任务说明。
  - 教训：判断目录内容时单独列这个目录，不要用 `head` 截断。
- 维护者确认后，#119 以 not planned 关闭，不打 `wontfix` 标签，关闭评论贴了核实结果。#119 上仍留着 `needs-triage` 标签（实测）。
- 维护者 2026-11-08 决定暂时不做 `pnpm setup:mpv`，也不做开发模式下缺少 `third_party/fntv-mpv` 时的提示。
- 截至这一节，本页涉及的 issue 都已关闭（`gh issue view` 逐个核对）：#74 至 #78、#87、#94、#114、#115、#118 为 completed，#119 为 not planned。
