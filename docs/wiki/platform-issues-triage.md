# 平台问题分诊（#74 至 #78、#87、#94）

相关：[多平台测试策略](multi-platform-testing.md)、[更新检查](update-check.md)、[构建依赖与 MPV 插件同步](build-dependencies.md)。来源：issue #74、#75、#76、#77、#78、#87、#94，以及 2026-11-08 的只读核实报告（子代理，chief of staff 会话）。#73 在 2026-11-08 核对时已不在 open 列表中，本页未核对。

## 2026-11-08 事实（`JayYa/fntv-electron@b888202`）

七个问题在 `b888202` 上都仍然存在。

#74：

- `src/main/common/mainwin.ts:14` 在所有平台都用 `build/icon.ico`。
- 读 Electron 文档 native-image：ICO 只在 Windows 上支持，其它平台只支持 PNG 和 JPEG。所以 Linux 上的图标一定加载失败，不需要上桌面验证。

#75：

- `src/public/platform.ts:58` 的 `restoreEvent` 在 Linux 上是 null，`src/main/common/tray.ts:309` 因此不绑定点击事件。
- 读 Electron tray 文档：Linux 上用户激活托盘图标时会发 `click`，但规范没有规定什么操作算激活；`double-click` 只在 macOS 和 Windows 上有。
- 哪些桌面会发 `click`，只能人工抽查。

#76：

- `src/main/main.ts:237-241` 在 Windows 和 Linux 上直接退出。
- `src/main/handlers/plugins/tray.ts:17-22` 只在 `isQuiting` 时退出。
- 推断，未逐行核对：主窗口的关闭会被拦下，所以目前两者效果相同。

#77：

- `src/public/platform.ts:86-90` 写死了配置目录。
- 读 mpv.rst 的 FILES 一节：
  - Linux 和 macOS 用 `$XDG_CONFIG_HOME/mpv`，未设时用 `~/.config/mpv`；`MPV_HOME` 优先于这两者。
  - Windows 用 `%APPDATA%/mpv`；`mpv.exe` 旁边有 `portable_config` 时只读那个目录。
  - `--config-dir` 优先于以上所有规则。
- 读代码：Windows 上用打包的 mpv 时，`src/main/handlers/plugins/media.ts:452-455` 会显式传 `--config-dir`，不受环境变量影响。用户自己指定 mpv 时不传这个参数，所以会对不上。macOS 和 Linux 用的是系统 mpv，会按 XDG 规则找配置。
- `media.ts:452` 直接用了 `os.platform()`。这违反了平台判断集中在 `platform.ts` 的约定；ESLint 只禁止读 `process.platform`，没有禁止调用 `os.platform()`。

#78：

- `src/modules/updater/updateChecker.ts:239-343` 用正则匹配安装包。
- `src/modules/updater/githubRelease.ts:89-93` 拼出精确的文件名。

#87：

- 读代码确认是初始化顺序问题，不是有意为之。
- `src/main/main.ts:2` 先导入 handlers，handlers 经 `interceptor.ts:2` 导入 logger。
- `src/modules/logger/logger.ts:314` 在模块加载时就 `new Logger()`，并在第 71 行读取 userData。
- 这一切都发生在 `src/modules/fn_config/config.ts:19` 调用 `setPath` 之前。
- 各平台的日志实际落在：
  - Windows：`%APPDATA%\fntv\logs`，与 [更新检查](update-check.md) 里的实测一致。
  - macOS：推断为 `~/Library/Application Support/fntv/logs`。
- 冒烟测试在 Windows 上传了 `--user-data-dir`，所以那里的日志路径与用户机器上的不同。`tests/smoke/targets.cjs` 按旧目录取日志。
- README 没有写日志在哪里。

#94：

- 问题在 `.github/workflows/release.yml:33-35`。
- 会自愈，不影响发布。

## 2026-11-08 核实报告的方案和推荐顺序（待维护者确认）

- #87：logger 推迟到第一次写日志时才取目录，或者直接用 `USER_DATA_PATH`。同时改 `targets.cjs`，在冒烟测试里断言 `~/.fntv/logs/app.log` 存在、旧目录不存在，并补 README。
- #74：在 `platformBehavior` 里加 `windowIcon`。冒烟测试可以用 `nativeImage.createFromPath(...).isEmpty()` 断言图标能加载。
- #75：Linux 上也绑定 `click` 事件。
- #76：只保留一个 `window-all-closed` 监听。
- #77：`mpvUserConfigDir` 接收环境变量，顺序是 `MPV_HOME`、`XDG_CONFIG_HOME`、`~/.config`；Windows 用 `app.getPath('appData')`。
- #78：`getDownloadUrl` 改为按 `expectedAssetName` 精确查找。
- #94：只加一句注释，或者按 wontfix 关闭。
- 推荐顺序：#87；#74、#75、#76 合成一个 PR；#77；#78；#94。
- 规模都是 S 或 S 到 M，都可以标 `ready-for-agent`。

## 2026-11-08 维护者决定

- 同意上面的顺序和合并方式：每项一个 PR，#74、#75、#76 合成一个 PR，都由子代理实现，从 #87 开始依次派出。上面“待维护者确认”的说法已被取代。
- #94 加注释，不按 wontfix 关闭。
- 不加 wiki 检查和 issue 分诊的定期任务。
- 依赖按改动文件冲突来定：#74 被 #87 阻塞，因为两者都改 `tests/smoke/targets.cjs`；#77 被 #74 阻塞，因为两者都改 `src/public/platform.ts`。#75、#76 跟 #74 在同一个 PR 里。#78、#94 不依赖其它 issue。

## 2026-11-08 进度

- 维护者合并了 PR #107（merge commit `3ad9ef9`）和 #108（merge commit `a364c2f`）。
- #108 的冒烟测试（`actions/runs/42484110972`）在 5 个安装包上都实际跑了两条日志目录断言（`writes app.log under ~/.fntv/logs`、`leaves no logs directory under the Electron default userData`），每个目标都是 pass 8、skipped 0。Windows 上第二条没有显示为 skip，说明走的是 `targets.cjs` 里 `CI=true` 的分支，用的是 runner 的真实用户目录。
- #74、#75、#76 合成一个 PR 实现：
  - #74：`platformBehavior` 加 `windowIcon`，Windows 是 `icon.ico`，其它平台是 `icon.png`。`build/` 整个打进 app.asar（`package.json` 的 `files`），PNG 在打包产物里。主窗口创建前把图标路径写进 `app.log`，冒烟测试读出路径，在主进程里用 `nativeImage.createFromPath` 加载，断言不为空。
  - #75：Linux 的 `restoreEvent` 改为 `click`，`tray.ts` 在所有平台都绑定。哪些 Linux 桌面真的会发 `click` 没有上桌面验证。
  - #76：保留 `src/main/main.ts` 里按 `quitsWhenAllWindowsClosed` 退出的监听，删掉 `handlers/plugins/tray.ts` 的监听和 `appHook` 的 `windowAllClosed` 钩子。读 Electron 38 的 `shell/browser/browser.cc`：`app.quit()` 进行中所有窗口关闭时直接退出，不发 `window-all-closed`；不在退出途中时主窗口的 `close` 被拦下改为隐藏。所以删掉的监听只在 `isQuiting` 为真却没在退出时才有作用，代码里没有这种情况，三个平台的行为不变。冒烟测试断言客户端只有 1 个 `window-all-closed` 监听。Electron 加载客户端代码前自己注册一个（`lib/browser/init.ts`，只在它是唯一监听时 `app.quit()`），run 42487555081 的 5 个目标都因为把它算进去报“实际是 2 个”而失败。2026-11-08 本机实测 Electron 38：裸 Electron 启动时已有 1 个；PR 分支的客户端启动后共 2 个（Electron 的和 `main.ts` 的），main 上共 3 个（多 `appHook` 的）。断言按函数源码里的 `listenerCount('window-all-closed')` 认出 Electron 那个并排除，认不出时算进来、断言失败。

## 2026-11-08 进度（#110 合并后）

- 维护者合并了 PR #110（#74、#75、#76，merge commit `2f84796`）。
- #110 的冒烟测试在 5 个安装包上都实际跑了图标断言和 `window-all-closed` 断言，没有跳过。
- 实测：Electron 38 在 `lib/browser/init.ts` 自带一个 `window-all-closed` 监听，断言把它排除后只数客户端自己的。
- 子代理派发的教训：
  - 派第二个任务去改同一分支前，先确认第一个已经停下。#110 上 `b8e0300` 和 `81b7d88` 是两个任务同时修同一个失败。
  - 子代理推送后立即交回报告，不等 CI。子代理收不到 CI 通知。
- #77 的 PR：
  - `mpvUserConfigDir(platform, { homeDir, appDataDir }, env)` 是纯函数，环境变量由参数传入。顺序：`MPV_HOME`；Windows 是 `appDataDir` 下的 `mpv`，其它平台是 `$XDG_CONFIG_HOME/mpv`，未设或不是绝对路径时 `~/.config/mpv`。空的 `MPV_HOME` 按未设处理。
  - 2026-11-08 读 mpv master 源码：
    - `osdep/path-win.c` 用 `FOLDERID_RoamingAppData` 取目录，不读 `%APPDATA%` 环境变量；mpv.exe 旁边有 `portable_config` 时只用它。所以 Windows 用 `app.getPath('appData')`，没有读 `APPDATA`。Electron 的 `appData` 与它是同一个系统目录，这一点是推断，没有在改了 `APPDATA` 的环境里实测。
    - `options/path.c` 不分平台读 `MPV_HOME`。值为空时 mpv 不读任何用户配置，本 PR 按未设处理。
    - `osdep/path-unix.c` 只在 `XDG_CONFIG_HOME` 以 `/` 开头时用它；`~/.mpv` 存在而 `~/.config/mpv` 不存在时用 `~/.mpv`，本 PR 没处理。
  - Windows 上 `MPV_HOME` 也生效。用户自己指定 mpv 时，同步目录就是 mpv 读的目录；用打包的 mpv 时 `--config-dir` 传的仍是 `getMpvConfigDir()`，没设 `MPV_HOME` 时路径和以前一样。
  - 没有处理用户自己的 mpv.exe 旁边有 `portable_config` 的情况：mpv 只读那里，同步仍写 AppData。
  - `media.ts` 改用 `currentPlatform()`。ESLint 在 `platform.ts` 以外禁止 `os.platform()`、`os.arch()`，以及具名导入、`require('os').platform()`、解构和用别的名字导入 `os` 模块（`tests/eslintPlatformRules.test.cjs`）。

## 2026-11-08 进度（#111、#112、#113 合并后）

- 维护者合并了 PR #111（#78，commit `c63d4d2`）、#112（#94，commit `3059bd9`）、#113（#77，commit `0e411a9`）。三个都是 squash 合并，`git log origin/main` 里没有单独的 merge commit，这里写的是合并到 main 上的那个 commit。
- 用 `gh issue view` 确认 #74 至 #78、#87、#94 七个 issue 都已关闭。
- #113 在 Windows 上用 `app.getPath('appData')`，没有用 `%APPDATA%`。理由是 mpv 在 Windows 上调系统 API（`FOLDERID_RoamingAppData`）取这个目录，不读环境变量。这一条来自 #113 的实现报告，没有实测。
- `MPV_HOME` 为空时按未设处理。
- #113 没处理的两种情况开了新 issue，都标 `needs-triage`：
  - #114：用户自己指定的 `mpv.exe` 旁边有 `portable_config` 时，mpv 只读那个目录，同步过去的配置不生效。
  - #115：mpv 还会读旧的 `~/.mpv` 目录，客户端没有考虑。

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
- 另一个现象：`%APPDATA%\mpv\scripts\uosc_danmaku\` 从 2026-11-08 18:43 起只剩 `.gitignore`。原因不明，开了 #119（`needs-triage`）。
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
- 同日更早的一次实测无效：维护者在 `813e805` 的旧代码 worktree 里启动，worktree 里没有 `third_party/fntv-mpv`，启动时同步报 “Portable config directory not found”。worktree 缺 `third_party/fntv-mpv` 导致测不成，这是第二次，第一次见 #54 的冒烟测试。chief of staff 建议改进环境：加 `pnpm setup:mpv`，或者开发模式下缺失时给出明确提示。维护者尚未决定。

### 核实 #119（只读，2026-11-08 约 23:50，待维护者确认）

结论：插件没有被删。现在的 `%APPDATA%\mpv\scripts\uosc_danmaku\` 是完整的，issue 里说的“只剩 `.gitignore`”在本机复现不出来。

- 实测：目录里有 17 个文件（`.gitignore`、`main.lua`、`apis/` 2 个、`dicts/` 2 个、`modules/` 11 个），和 `t3-07352ab5` 里 `third_party/fntv-mpv/portable_config/scripts/uosc_danmaku` 逐个比对（`diff -rq`）完全相同。#118 一节里说的“18 个文件”是 `unzip -l` 的条目数，可能把目录条目也算进去了，没有核对。
- 实测：每个文件和子目录的创建时间都是 18:43:45，文件的修改时间都是 00:42:26（是来源文件的时间）。`uosc_danmaku` 和三个子目录的修改时间也都是 18:43:45，之后再没有增删。
- 实测（客户端日志 `%APPDATA%\fntv\logs\app.log`）：18:43:45.117 启动的是安装版 2.7.1，18:43:45.433 记“MPV托管插件已同步: uosc_danmaku”。2.7.1 的代码早于 #113，目标是 `%APPDATA%\mpv`，目标已有 `scripts`，所以删掉 `uosc_danmaku` 重新复制。18:43 就是这次正常同步，不是删除。
- 实测（`%APPDATA%\mpv\mpv.log`，最后写入 18:55:53）：mpv 带 `--config-dir=C:\Users\xiaos\AppData\Roaming\mpv` 启动，加载了 `uosc_danmaku/main.lua`，插件报版本 2.1.0，没有 `Cannot find main.*`。
- 推断：如果 18:43:45 之后目录被删到只剩 `.gitignore` 又被恢复，各个目录的修改时间会晚于 18:43:45。实际没有，所以 18:43 以后目录一直完整。
- 推断：issue 里的“只剩 `.gitignore`”可能是观察出错，比如看错了目录（例如被 #118 清空的某个 worktree 里的 `portable_config`），或者用的列目录方式漏掉了文件。具体是哪种，没有查到。目录不在 git 仓库里，`.gitignore` 的规则（`danmaku/*`、`*.toml`、`.*`）不会影响 mpv 或客户端读取，也不会隐藏 `.lua` 文件（读规则，推断）。
- issue 里列的其它方向都可以排除：#113、#117 之前的同步代码在 18:43 正常复制了全部文件（日志和创建时间，实测）；插件自更新没有触发的记录（实测 `mpv.log` 里没有 `check-update`，但这个日志只记最后一次 18:55 的运行，18:43 到 18:55 之间是否触发过看不到；即使触发，附带的 2.1.0 已是最新版，不会替换目录，读代码，推断）；开发版启动会写 `~/.fntv/logs`，本机没有这个目录（实测），`app.log` 里 14:30 之后、23 点之前的启动只有 18:43 这一次安装版（实测）。
- 修复方案：不需要改代码，规模为 0。建议在 #119 评论里写明上面的实测结果，标 `wontfix` 关闭（复现不了）。维护者如果当时看到的确实是另一个目录，可以补一句说明再关闭。
