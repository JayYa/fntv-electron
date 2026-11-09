# 构建依赖与 MPV 插件同步

相关：[发布与更新链路](release-and-update.md)（release-please 发版流程、Release PR 上的检查）、[多平台测试策略](multi-platform-testing.md)。

## 2026-11-08 事实：三个平台为什么都下载 MPV 压缩包（`JayYa/fntv-electron@7586698`）

- 已被取代（2026-11-09，见末尾“升级 MPV 归档到 fntv-mpv-v20261108_233327”）：~~`build.yml` 在三个平台上下载同一个压缩包 `JayYa/fntv-mpv-config` 的 `mpv-package-20260825_173358.zip`（tag `fntv-mpv-v20260826_013404`，固定 sha256）。内容是 Windows 版 MPV 加 `portable_config`。~~
- macOS 和 Linux 也下载，是因为打包要从里面取 `portable_config`。
- `package.json` 的 `build` 配置：`win.extraFiles` 带整个 `third_party/fntv-mpv`（含 `mpv.exe`）和 `third_party/proxy`；`mac.extraFiles` 和 `linux.extraFiles` 只带 `third_party/fntv-mpv/portable_config` 和 `third_party/proxy`。
- 2026-11-08 用 `7z l` 列 v2.7.2 的 AppImage 和 mac arm64 DMG（记录在 PR #102 正文）：`third_party` 下只有 `fntv-mpv/portable_config`（81 个文件）和 `proxy/proxy`，没有 `mpv.exe` 或 `.dll`。同一次检查里唯一的 `.exe` 是 uosc 插件自带的 `ziggy-windows.exe`（在 `portable_config` 里，PR #102 正文没写）。

## 2026-11-08 构建下载缓存（PR #101，`3c66b15`）

- 起因：#100 的 Smoke Test 运行 `actions/runs/42465978208` 第 1 次尝试里，macOS 和 Windows 构建失败在 `Download third-party dependencies`，从 `JayYa/fntv-mpv-config` Release 下载 MPV 压缩包时 GitHub 返回 504。原来的 `curl --retry 3` 退避只有 1 到 4 秒。
- MPV 压缩包缓存（`build.yml`）：tag、资产名和 sha256 从下载步骤移到 `build` job 的 `env`。`actions/cache/restore` 和 `actions/cache/save` 分开写（v6.1.0），路径 `$RUNNER_TEMP/mpv-archive`，key `mpv-archive-${{ runner.os }}-${{ env.MPV_CONFIG_SHA256 }}`。下载并校验通过后立即保存，命中时不保存，两步都 `continue-on-error`。命中缓存也校验 sha256，不通过就重新下载。
- 未命中时 `curl -fsSL --retry 5 --retry-delay 10 --retry-all-errors --retry-max-time 300 --connect-timeout 30`，下载步骤 `timeout-minutes: 10`。
- 已被取代（2026-11-09，见末尾“构建 job 也跳过 postinstall 下载”）：~~打包下载缓存：key `packaging-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}`，`Build application` 设 `ELECTRON_BUILDER_CACHE=$RUNNER_TEMP/electron-builder-cache`，构建成功后保存。#101 的 workflow 注释写的是：Electron zip 由 `@electron/get` 存到默认目录，它不读 `ELECTRON_CACHE`，所以缓存路径同时列出三个平台的默认目录：Linux `~/.cache/electron`、macOS `~/Library/Caches/electron`、Windows `%LOCALAPPDATA%\electron\Cache`（workflow 里写 `~/AppData/Local/electron/Cache`）。~~
- 2026-11-08 写本节时看 `pnpm-lock.yaml` 和 `node_modules`：`electron@38.0.0` 依赖 `@electron/get` 2.0.3，`app-builder-lib@26.18.0` 依赖 3.1.0。两个版本的 `dist/cjs/Cache.js` 默认目录都是 `env-paths('electron').cache`，`Cache.js` 和 `index.js` 里都没有 `ELECTRON_CACHE`。打包时实际由哪个版本下载、存到哪里，没有核对；`packaging-*` 缓存是否覆盖 Electron zip，要看下一次命中后的构建日志。（2026-11-08 已核实目录，见下一节；命中仍未验证。）
- `tests/releaseGate.test.cjs` 新增检查：key 含 sha256、restore 在下载前、save 紧跟产生内容的步骤；用桩 `curl`、`unzip` 实际跑下载步骤，缓存校验通过时只解压，不通过时重新下载。`docs/external-runtime.md` 和 `CODING_STANDARDS.md` 同步写明。
- #101 自己的 Smoke Test 运行 `actions/runs/42469305936`（head `7bf70c6`）：
  - 第 1 次尝试：macOS 下载 6 次全是 504，重试用完失败；Windows 下载重试 5 次后成功，`Build application` 里 electron-builder 下载也返回 504 失败；Linux 也失败在 `Build application`，同样是 electron-builder 下载返回 504。
  - 第 2 次尝试：macOS 下载仍是 6 次 504。
  - 第 3 次尝试通过：Linux、Windows 的 MPV 缓存命中（`Using cached archive`），macOS 未命中，下载后保存；三个平台的 `packaging-*` 缓存都未命中，构建后保存。
- 504 的原因没有排查。缓存只减少下载次数，第一次未命中时仍依赖重试。
- 三个平台为什么都要下载 MPV 压缩包，见上方第一节。

## 2026-11-08 核实：打包时 Electron zip 的下载和缓存目录（`d9cf99a`）

本节回答上一节"打包时实际由哪个版本下载、存到哪里，没有核对"。结论：#101 的缓存路径正确，没有改代码。

- 下载方：`electron-builder --win/--mac/--linux` 走 `app-builder-lib/out/electron/ElectronFramework.js:221` 的 `downloadElectronArtifactZip`，不传 `cacheDir`；`out/util/electronGet.js:672-716` 的 `buildElectronArtifactConfig` 里 `cacheRoot` 只来自 `cacheDir` 参数或 `build.electronDownload.cache`，本项目都没配。之后 `electronGet.js:150` 调 `app-builder-lib/node_modules/@electron/get`（3.1.0）的 `downloadArtifact`。
- 目录：3.1.0 的 `dist/cjs/Cache.js:22-26` 在 `cacheRoot` 为空时用 `env-paths('electron',{suffix:''}).cache`，和 2.0.3 相同：Linux `$XDG_CACHE_HOME/electron`（未设时 `~/.cache/electron`）、macOS `~/Library/Caches/electron`、Windows `%LOCALAPPDATA%\electron\Cache`。
- 环境变量：3.1.0 不读 `ELECTRON_CACHE`。`electron_config_cache` 只在 `node_modules/electron/install.js:46`（postinstall，用 2.0.3）读取，和打包无关。`ELECTRON_BUILDER_CACHE` 不影响 Electron zip。要改 Electron zip 目录只能配 `build.electronDownload.cache`。Windows 本地实测：同时设 `ELECTRON_CACHE` 和 `electron_config_cache`，`cacheRoot` 仍为 undefined，zip 落在 `%LOCALAPPDATA%\electron\Cache`（`electron-v38.0.0-win32-x64.zip`，125,665,776 B）。
- 打包工具（nsis、nsis-resources、7zip、appimage、dmgbuild、winCodeSign）走 `binDownload.js:85-104` 的 `getBin`，目录由 `electronGet.js:41-46` 的 `getCacheDirectory({allowEnvVarOverride:true})` 决定：`ELECTRON_BUILDER_CACHE` 为绝对路径时直接用。`macCodeSign.js:100` 也读这个变量。
- `actions/runs/42469305936` 第 3 次尝试的 `packaging-*` 保存：Linux 238,074,531 B（electron x64、arm64，appimage-12.0.1，7zip-linux-x64）；Windows 133,774,532 B（electron，7zip-win-x64，nsis-3.0.4.1，nsis-resources-3.4.1）；macOS 297,740,746 B（electron ×2，dmgbuild-bundle-arm64）。三个平台都没有路径不存在的警告。Windows 的大小约等于一个 Electron zip 加约 8 MB 工具，说明 Electron 目录被存进去了。
- 命中尚未验证：这三份缓存的 ref 是 `refs/pull/101/merge`，按 actions/cache 的 ref 隔离，main 和其它 PR 用不上。#101 合并后，截至 `d9cf99a`，release.yml 的运行 `42476442255`、`42476908063`、`42478821622` 都跳过了构建，main 上还没跑过打包。main 上第一次构建一定不命中。（2026-11-08 已在 main 上验证 Windows，见下一条。）
- 2026-11-08 在 main 上手动触发 Smoke Test（`platform=windows`）验证 Windows 命中：
  - `actions/runs/42481000292`：被同组并发设置取消（触发第二次时它还在跑），不算。
  - `actions/runs/42481067560`：`mpv-archive-Windows-*` 和 `packaging-Windows-*` 都未命中，构建后保存。打包下载了 7zip-win-x64、nsis-3.0.4.1、nsis-resources-3.4.1。build job 2 分 57 秒。
  - `actions/runs/42481513994`：两个缓存都命中（`Cache restored from key`），`packaging-Windows-*` 恢复 133,774,377 B，MPV 压缩包 56,918,539 B，日志出现 `Using cached archive`，打包没有再下载 7zip、nsis。build job 2 分 5 秒。
  - 两次运行里 electron-builder 的 `downloaded label=electron` 都在 `packaging` 后约 0.1 到 0.4 秒出现，未命中的那次也一样，不像真的下载了 125 MB。推测 Electron zip 在 `pnpm install` 时已由 `electron` 包的 postinstall 放进同一个默认目录，没有核实。macOS、Linux 的命中没有验证。

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
- 冒烟测试用新归档跑的结果没有记录，待 CI。

## 2026-11-09 CI Test job 的 Electron 下载改为单独步骤，带缓存和重试

- 起因：PR #140 的 CI 运行 [`42566088223`](https://github.com/JayYa/fntv-electron/actions/runs/42566088223)（head `2c8ed82`）第 1 次尝试，Windows 和 macOS 的 Test 都失败在 `pnpm install`：`node_modules/electron postinstall: HTTPError: Response code 504`，Linux 通过；第 2 次尝试全过。`ci.yml` 的 Test job 每次安装都由 `electron` 的 postinstall 从 GitHub 下载 Electron zip，没有缓存，失败时整个 install 失败。和 #101 的构建下载 504 是同一类问题，504 的原因仍没有排查。
- 先考虑整个跳过下载（`ELECTRON_SKIP_BINARY_DOWNLOAD=1`）。`electron@38.8.6` 的 `install.js:14` 支持它，设了直接以 0 退出；`electron.d.ts` 在 npm 包里，`tsc` 和 lint 不受影响。但 `node_modules/electron/index.js` 在没有 `path.txt` 时抛 `Electron failed to install correctly`。本地移走 `path.txt` 跑 `node --test tests/*.test.cjs`：345 个里失败 2 个，`tests/accessCodeSession.test.cjs`（`dest/main/common/accessCodeSession.js` 顶层 `import { net, session } from 'electron'`）整个文件加载失败，`tests/standards.test.cjs` 的 `electron finished extracting its binary`（防 `yauzl` 回归）失败。所以 Test job 需要二进制，不能整个跳过。
- 改法（本节所在 PR，`ci.yml`）：
  - `Install dependencies` 设 `ELECTRON_SKIP_BINARY_DOWNLOAD: '1'`，postinstall 不下载，其它包的安装脚本照常跑。
  - 新增 `Download Electron binary`：运行 `node node_modules/electron/install.js`，失败重试，共 5 次，间隔 15、30、45、60 秒，最后检查 `path.txt`，`timeout-minutes: 10`。`install.js` 先看 `dist/version` 和 `path.txt`，已装好时不下载。
  - 前后各加 `actions/cache/restore`、`actions/cache/save`（v6.1.0，`continue-on-error`，未命中才保存，save 紧跟下载步骤），路径是 #101 核实过的三个平台的 `@electron/get` 默认目录，key `electron-${{ runner.os }}-${{ hashFiles('node_modules/electron/package.json') }}`，只随 Electron 版本变化。
- 已被取代（2026-11-09，见末尾“构建 job 也跳过 postinstall 下载”）：~~缓存的局限：`ci.yml` 只在 `pull_request` 上跑，缓存按 PR 的 ref 隔离，只在同一个 PR 的后续推送和重跑里命中，新 PR 的第一次运行仍要下载，主要靠重试。没有给 `ci.yml` 加 `push: main` 来预热缓存。~~
- 测试（新文件 `tests/ciElectronDownload.test.cjs`）：检查 install 设了跳过、下载步骤在 install 和测试之间、缓存 restore/save 的约定和 key；用桩 `node` 实际跑下载步骤，前 2 次失败时第 3 次成功，一直失败时 5 次后步骤失败。`CODING_STANDARDS.md` 的 GitHub Workflow 节同步写明。提交钩子限制单个文件 20000 字节，`tests/releaseGate.test.cjs` 加上这些测试后超了，所以把 `workflow`、`runStep`、`assertRestoreAndSave`、`posixPath`、`asList` 移到 `tests/helpers/workflowSteps.cjs`，两个测试文件共用。
- 已被取代（2026-11-09，见末尾“构建 job 也跳过 postinstall 下载”）：~~`build.yml` 的 `Install dependencies` 仍在 postinstall 里下载 Electron，没有改。~~

## 2026-11-09 构建 job 也跳过 postinstall 下载，打包缓存按版本定 key，main 上预热

- 起因：Renovate PR #139 的 Smoke Test 运行 [`42569356351`](https://github.com/JayYa/fntv-electron/actions/runs/42569356351) 的 build job 反复失败于 GitHub 下载 504：Windows 在 `pnpm install` 的 electron postinstall（上一节只改了 `ci.yml`）；Linux、macOS 在 electron-builder 打包时。第 3 次尝试里 macOS 仍失败：`packaging-macOS-*` 未命中（key 用锁文件 hash，依赖 PR 每次都变），日志先是 `downloaded label=electron progress=100%`，约 23 秒后 504，没有 URL。
- 共用安装：新增 composite action `.github/actions/install-dependencies`，即上一节 `ci.yml` 的安装、缓存和下载步骤，`ci.yml`、`build.yml` 都调用它，超时写在调用步骤上（composite 步骤不支持 `timeout-minutes`）。`tests/standards.test.cjs` 的 workflow 规则也检查它。
- 缓存 key：`scripts/ci-download-cache.cjs keys` 从 `package.json` 读 `electron`、`electron-builder` 的固定版本（不是固定版本时报错），从锁文件读唯一的 `app-builder-lib` 版本。Electron key 改为 `electron-<os>-<electron 版本>`；打包 key 为 `packaging-<os>-electron-<版本>-electron-builder-<版本>-app-builder-lib-<版本>`，`restore-keys` 依次是同一 Electron 版本、同一平台的前缀。安装依赖前也能算。
- 打包前 `prepare-packaging`：删掉从旧 key 恢复带进来的其它 Electron 版本的 zip，免得越存越大；从 `node_modules/electron/checksums.json` 写 `SHASUMS256.txt-<版本>` 到 `@electron/get` 默认目录。原因：`app-builder-lib/node_modules/@electron/get`（3.1.0）`dist/cjs/index.js` 的 `downloadArtifact` 命中缓存后仍调 `validateArtifact`，没有 `checksums` 时用 `cacheMode: Bypass` 联网下载 `SHASUMS256.txt`，缓存全命中也要联网。`app-builder-lib@26.18.0` 的 `out/util/electronGet.js` 的 `resolveSeededChecksums` 读缓存根目录的 `SHASUMS256.txt-<版本>`，有对应条目时作为 `checksums` 离线校验。本地实测写入后 `buildElectronArtifactConfig` 返回的配置带上了 `checksums`。上面 macOS 的 504 是不是这个请求，没有核实。
- 打包下载的重试：`electronGet.js` 的 `downloadArtifactToFile` 对 Electron zip 和打包工具都只重试 3 次（`interval` 2000、`backoff` 2000 毫秒），写死，没有配置项或环境变量。`build.electronDownload` 能传 `downloadOptions` 给 got 11，但 `GotDownloader` 用 `got.stream`，got 11 的 `retry` 对 stream 不生效，没有用。所以在 `Build application` 外层重试：日志有 5xx 或网络错误（匹配模式见 `build.yml`）时整条打包命令重跑，共 3 次，间隔 30、60 秒，其它错误直接失败。步骤超时 15 → 30 分钟，job 30 → 45 分钟。
- main 上预热：缓存按 ref 隔离，PR 只能读自己的和 base 分支的；`ci.yml` 只在 `pull_request` 上跑，main 上只有发版时构建。没有给 `ci.yml` 加 `push: main`：每次合并都要跑三平台 Test，且预热不了打包缓存。新增 `cache-warm.yml`：push 到 main 且改了 `package.json`、锁文件、`build.yml`、action 或脚本时，每周一（补 7 天没读被清掉的缓存），或手动触发。先用 `gh api repos/<仓库>/actions/caches`（`actions: read`）查 main 上每个平台的两个 key，缺的平台才调 `build.yml` 打包一次（`build.yml` 新增输入 `upload`，这里传 `false`，不上传安装包）。成本：仓库是公开的，GitHub 托管的标准 runner 不计费；按 `42569356351` 的 build job 各约 4 分钟算，版本变化时约 13 个 runner 分钟，版本不变时只跑一次查询 job。
- 测试：`tests/ciElectronDownload.test.cjs` 改为检查 action 和两处调用；新文件 `tests/buildDownloads.test.cjs` 检查 key、`prepare-packaging`、打包重试（桩 `pnpm`）和 `cache-warm.yml` 只构建缺缓存的平台（桩 `gh`），原 `tests/releaseGate.test.cjs` 的打包缓存测试移来。
