# 构建依赖与 MPV 插件同步

相关：[发布与更新链路](release-and-update.md)（release-please 发版流程、Release PR 上的检查）、[多平台测试策略](multi-platform-testing.md)。

## 2026-11-08 事实：三个平台为什么都下载 MPV 压缩包（`JayYa/fntv-electron@7586698`）

- `build.yml` 在三个平台上下载同一个压缩包 `JayYa/fntv-mpv-config` 的 `mpv-package-20260825_173358.zip`（tag `fntv-mpv-v20260826_013404`，固定 sha256）。内容是 Windows 版 MPV 加 `portable_config`。
- macOS 和 Linux 也下载，是因为打包要从里面取 `portable_config`。
- `package.json` 的 `build` 配置：`win.extraFiles` 带整个 `third_party/fntv-mpv`（含 `mpv.exe`）和 `third_party/proxy`；`mac.extraFiles` 和 `linux.extraFiles` 只带 `third_party/fntv-mpv/portable_config` 和 `third_party/proxy`。
- 2026-11-08 用 `7z l` 列 v2.7.2 的 AppImage 和 mac arm64 DMG（记录在 PR #102 正文）：`third_party` 下只有 `fntv-mpv/portable_config`（81 个文件）和 `proxy/proxy`，没有 `mpv.exe` 或 `.dll`。同一次检查里唯一的 `.exe` 是 uosc 插件自带的 `ziggy-windows.exe`（在 `portable_config` 里，PR #102 正文没写）。

## 2026-11-08 构建下载缓存（PR #101，`3c66b15`）

- 起因：#100 的 Smoke Test 运行 `actions/runs/42465978208` 第 1 次尝试里，macOS 和 Windows 构建失败在 `Download third-party dependencies`，从 `JayYa/fntv-mpv-config` Release 下载 MPV 压缩包时 GitHub 返回 504。原来的 `curl --retry 3` 退避只有 1 到 4 秒。
- MPV 压缩包缓存（`build.yml`）：tag、资产名和 sha256 从下载步骤移到 `build` job 的 `env`。`actions/cache/restore` 和 `actions/cache/save` 分开写（v6.1.0），路径 `$RUNNER_TEMP/mpv-archive`，key `mpv-archive-${{ runner.os }}-${{ env.MPV_CONFIG_SHA256 }}`。下载并校验通过后立即保存，命中时不保存，两步都 `continue-on-error`。命中缓存也校验 sha256，不通过就重新下载。
- 未命中时 `curl -fsSL --retry 5 --retry-delay 10 --retry-all-errors --retry-max-time 300 --connect-timeout 30`，下载步骤 `timeout-minutes: 10`。
- 打包下载缓存：key `packaging-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}`，`Build application` 设 `ELECTRON_BUILDER_CACHE=$RUNNER_TEMP/electron-builder-cache`，构建成功后保存。#101 的 workflow 注释写的是：Electron zip 由 `@electron/get` 存到默认目录，它不读 `ELECTRON_CACHE`，所以缓存路径同时列出三个平台的默认目录：Linux `~/.cache/electron`、macOS `~/Library/Caches/electron`、Windows `%LOCALAPPDATA%\electron\Cache`（workflow 里写 `~/AppData/Local/electron/Cache`）。
- 2026-11-08 写本节时看 `pnpm-lock.yaml` 和 `node_modules`：`electron@38.0.0` 依赖 `@electron/get` 2.0.3，`app-builder-lib@26.18.0` 依赖 3.1.0。两个版本的 `dist/cjs/Cache.js` 默认目录都是 `env-paths('electron').cache`，`Cache.js` 和 `index.js` 里都没有 `ELECTRON_CACHE`。打包时实际由哪个版本下载、存到哪里，没有核对；`packaging-*` 缓存是否覆盖 Electron zip，要看下一次命中后的构建日志。
- `tests/releaseGate.test.cjs` 新增检查：key 含 sha256、restore 在下载前、save 紧跟产生内容的步骤；用桩 `curl`、`unzip` 实际跑下载步骤，缓存校验通过时只解压，不通过时重新下载。`docs/external-runtime.md` 和 `CODING_STANDARDS.md` 同步写明。
- #101 自己的 Smoke Test 运行 `actions/runs/42469305936`（head `7bf70c6`）：
  - 第 1 次尝试：macOS 下载 6 次全是 504，重试用完失败；Windows 下载重试 5 次后成功，`Build application` 里 electron-builder 下载也返回 504 失败；Linux 也失败在 `Build application`，同样是 electron-builder 下载返回 504。
  - 第 2 次尝试：macOS 下载仍是 6 次 504。
  - 第 3 次尝试通过：Linux、Windows 的 MPV 缓存命中（`Using cached archive`），macOS 未命中，下载后保存；三个平台的 `packaging-*` 缓存都未命中，构建后保存。
- 504 的原因没有排查。缓存只减少下载次数，第一次未命中时仍依赖重试。
- 三个平台为什么都要下载 MPV 压缩包，见上方第一节。

## 2026-11-08 事实：插件同步（`7586698`）

- 启动时 `src/main/main.ts:72` 调用 `registerAllPlugins`（`src/main/handlers/index.ts:48`）。它加载 `plugins` 目录下的每个插件并调用 `init`，其中包括 `src/main/handlers/plugins/mpvConfig.ts` 的 `init`。每次启动都执行，没有开关。所有平台都执行。
- 目标目录由 `src/public/platform.ts:86` 的 `mpvUserConfigDir` 决定：Windows 是 `~/AppData/Roaming/mpv`，macOS 和 Linux 是 `~/.config/mpv`。不读 `XDG_CONFIG_HOME`（issue #77）。
- 同步逻辑在 `src/main/common/mpvConfigHelpers.ts:50` 的 `synchronizeMpvConfig`：
  - 目标没有 `scripts` 目录：把整个 `portable_config` 复制过去，已有文件跳过不覆盖（第 61 行）；
  - 目标已有 `scripts` 目录：只删掉并重建 `scripts/uosc_danmaku`（第 72 行），其它插件不动。
- `portable_config` 或其中的 `scripts/uosc_danmaku` 不存在时抛错（第 55、68 行），`mpvConfig.ts:42` 捕获后只记 `初始化MPV配置失败` 日志，不影响启动。
- Windows 只在使用内置 `mpv.exe`（没有配置自定义播放器路径）时给 MPV 传 `--config-dir=<用户配置目录>`（`src/main/handlers/plugins/media.ts:452`）。macOS 和 Linux 用系统安装的 MPV，不传这个参数，MPV 默认读 `~/.config/mpv`。

## 2026-11-08 README 改正（PR #102，`7586698`）

- 改正前 README 说 Linux 插件要去 fntv-mpv 自行安装，与上面的代码不符。
- 改正后：macOS 自己装 MPV，推荐 Homebrew；Linux 自己装 MPV（版本 > 0.37.0）。安装包只带插件和配置，启动时同步到 `~/.config/mpv`。用户配置里已有自己的 `scripts` 目录时只更新 `uosc_danmaku`，其它插件要手动复制一次。
