# 构建依赖与 MPV 插件同步

相关：[CI 下载与缓存](ci-download-cache.md)（2026-11-09 从本页拆出：#101 构建下载缓存、打包时 Electron zip 目录核实、#143 Test job 的 Electron 下载、#146 打包缓存按版本定 key 和 main 上预热）、[发布与更新链路](release-and-update.md)（release-please 发版流程、Release PR 上的检查）、[多平台测试策略](multi-platform-testing.md)。

## 2026-11-08 事实：三个平台为什么都下载 MPV 压缩包（`JayYa/fntv-electron@7586698`）

- 已被取代（2026-11-09，见末尾“升级 MPV 归档到 fntv-mpv-v20261108_233327”）：~~`build.yml` 在三个平台上下载同一个压缩包 `JayYa/fntv-mpv-config` 的 `mpv-package-20260825_173358.zip`（tag `fntv-mpv-v20260826_013404`，固定 sha256）。内容是 Windows 版 MPV 加 `portable_config`。~~
- macOS 和 Linux 也下载，是因为打包要从里面取 `portable_config`。
- `package.json` 的 `build` 配置：`win.extraFiles` 带整个 `third_party/fntv-mpv`（含 `mpv.exe`）和 `third_party/proxy`；`mac.extraFiles` 和 `linux.extraFiles` 只带 `third_party/fntv-mpv/portable_config` 和 `third_party/proxy`。
- 2026-11-08 用 `7z l` 列 v2.7.2 的 AppImage 和 mac arm64 DMG（记录在 PR #102 正文）：`third_party` 下只有 `fntv-mpv/portable_config`（81 个文件）和 `proxy/proxy`，没有 `mpv.exe` 或 `.dll`。同一次检查里唯一的 `.exe` 是 uosc 插件自带的 `ziggy-windows.exe`（在 `portable_config` 里，PR #102 正文没写）。

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

## 2026-11-09 升级 MPV 归档到 fntv-mpv-v20261108_233327（PR #123）

- 新归档：`JayYa/fntv-mpv-config` tag `fntv-mpv-v20261108_233327`（2026-11-08T15:33Z 发布），资产 `mpv-package-20261108_153320.zip`（57,758,202 B），sha256 `783cc16db5c70e88cd30f8c16f20843799a6983ef20eae2c562f549b7a67b1fc`。本地 `gh release download` 后算的 sha256 和 Release 页面的 digest 一致。旧归档是 `fntv-mpv-v20260826_013404` 的 `mpv-package-20260825_173358.zip`（sha256 `1d9f5fe6…5c5b`）。
- 来源变了：旧 tag 是上游同 tag 的镜像；新 tag 由 `JayYa/fntv-mpv-config` 的 `release` 分支（`7776970`，"feat: add thumbfast thumbnail plugin"）自己构建，上游 `QiaoKes/fntv-mpv-config` 没有这个 Release，最新仍是 `fntv-mpv-v20260826_013404`，上游 `release` 分支落后 `7776970` 3 个提交。`docs/external-runtime.md` 同步改了这句。
- 新旧归档解压后 diff（92 → 97 个文件，`portable_config` 81 → 86 个）：
  - `mpv.exe`、`mpv.com` 换成 20261108 的构建。
  - uosc 5.12.0 → 5.13.0：`scripts/uosc` 下 `main.lua`、`lib/cursor.lua`、`lib/utils.lua` 和 7 个 `elements/*.lua` 有改动，新增 `intl/it.json`、`pt.json`、`zh-HK.json`。`script-opts/uosc.conf` 删掉 `font=Noto Sans Mono CJK SC`（改用 `mpv.conf` 的 `osd-font`）和 `ziggy_path=` 两项。
  - 新增 thumbfast 缩略图插件：`scripts/thumbfast.lua` 和 `script-opts/thumbfast.conf`（`network=yes`、`max_height=200`、`max_width=200`、`hwdec=no`）。
  - `mpv/fonts.conf` 大小 2,703 B → 2,522 B（按 zip 列表；本地没解压出来，见下方，内容没有 diff）。
  - 不变：`scripts/uosc_danmaku` 整个目录、`mpv.conf`、`input.conf`、`smart_skip`、`danmaku-history.json`。
- 没有破坏性变化：客户端只依赖 `third_party/fntv-mpv/mpv.exe`、`portable_config` 和其中的 `scripts/uosc_danmaku`（`mpvConfigHelpers.ts`、`package.json` 的 `extraFiles`），都还在。`tests/` 和 `tests/smoke/` 不检查归档内容，`tests/releaseGate.test.cjs` 只要求 sha256 是 64 位十六进制。
- 已有 `scripts` 目录的用户升级后只换 `uosc_danmaku`（见上方“插件同步”），uosc 5.13.0 和 thumbfast 不会自动装上，和 README 已写的手动复制说明一致。
- 本地用 Git Bash 的 `unzip` 解压新旧两个归档都报 `checkdir error: mpv exists but is not directory`，跳过 `mpv/fonts.conf`。推测是 MSYS 把 `mpv` 当成已解压的 `mpv.exe`，旧归档也一样，不是这次引入的；CI 的 Windows 用 `Expand-Archive`，没有核实它是否受影响。
- 已被取代（2026-11-09，见[CI 下载与缓存](ci-download-cache.md)的“#146 合并后验证”：main 上已缓存 `783cc16d…` 归档，重建后的 Renovate PR 冒烟测试全绿）：~~冒烟测试用新归档跑的结果没有记录，待 CI。~~
