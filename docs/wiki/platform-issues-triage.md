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
