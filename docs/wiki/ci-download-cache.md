# CI 下载与缓存

2026-11-09 从 [构建依赖与 MPV 插件同步](build-dependencies.md) 拆出，原文未改，原因是原文件接近提交钩子的 20000 字节上限。移来的是 #101、打包时 Electron zip 目录核实、#143、#146 四节。节内“上方第一节”指原页的“三个平台为什么都下载 MPV 压缩包”；“下一节”“见末尾”指本页的节。

相关：[CI 缓存额度与清理](ci-cache-quota.md)（2026-11-10 起的记录，本页已接近 20000 字节上限）、[构建依赖与 MPV 插件同步](build-dependencies.md)（MPV 压缩包、插件同步、MPV 归档升级）、[多平台测试策略](multi-platform-testing.md)、[依赖更新（Renovate）](dependency-updates.md)、[发布与更新链路](release-and-update.md)。

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

## 2026-11-09 CI Test job 的 Electron 下载改为单独步骤，带缓存和重试

- 起因：PR #140 的 CI 运行 [`42566088223`](https://github.com/JayYa/fntv-electron/actions/runs/42566088223)（head `2c8ed82`）第 1 次尝试，Windows 和 macOS 的 Test 都失败在 `pnpm install`：`node_modules/electron postinstall: HTTPError: Response code 504`，Linux 通过；第 2 次尝试全过。`ci.yml` 的 Test job 每次安装都由 `electron` 的 postinstall 从 GitHub 下载 Electron zip，没有缓存，失败时整个 install 失败。和 #101 的构建下载 504 是同一类问题，504 的原因仍没有排查。
- 先考虑整个跳过下载（`ELECTRON_SKIP_BINARY_DOWNLOAD=1`）。`electron@38.8.6` 的 `install.js:14` 支持它，设了直接以 0 退出；`electron.d.ts` 在 npm 包里，`tsc` 和 lint 不受影响。但 `node_modules/electron/index.js` 在没有 `path.txt` 时抛 `Electron failed to install correctly`。本地移走 `path.txt` 跑 `node --test tests/*.test.cjs`：345 个里失败 2 个，`tests/accessCodeSession.test.cjs`（`dest/main/common/accessCodeSession.js` 顶层 `import { net, session } from 'electron'`）整个文件加载失败，`tests/standards.test.cjs` 的 `electron finished extracting its binary`（防 `yauzl` 回归）失败。所以 Test job 需要二进制，不能整个跳过。
- 改法（本节所在 PR，`ci.yml`）：
  - 已被取代（2026-11-09，见末尾“Electron 45 下的下载机制”）：~~`Install dependencies` 设 `ELECTRON_SKIP_BINARY_DOWNLOAD: '1'`，postinstall 不下载，其它包的安装脚本照常跑。~~
  - 新增 `Download Electron binary`：运行 `node node_modules/electron/install.js`，失败重试，共 5 次，间隔 15、30、45、60 秒，最后检查 `path.txt`，`timeout-minutes: 10`。`install.js` 先看 `dist/version` 和 `path.txt`，已装好时不下载。
  - 前后各加 `actions/cache/restore`、`actions/cache/save`（v6.1.0，`continue-on-error`，未命中才保存，save 紧跟下载步骤），路径是 #101 核实过的三个平台的 `@electron/get` 默认目录，key `electron-${{ runner.os }}-${{ hashFiles('node_modules/electron/package.json') }}`，只随 Electron 版本变化。
- 已被取代（2026-11-09，见末尾“构建 job 也跳过 postinstall 下载”）：~~缓存的局限：`ci.yml` 只在 `pull_request` 上跑，缓存按 PR 的 ref 隔离，只在同一个 PR 的后续推送和重跑里命中，新 PR 的第一次运行仍要下载，主要靠重试。没有给 `ci.yml` 加 `push: main` 来预热缓存。~~
- 测试（新文件 `tests/ciElectronDownload.test.cjs`）：检查 install 设了跳过、下载步骤在 install 和测试之间、缓存 restore/save 的约定和 key；用桩 `node` 实际跑下载步骤，前 2 次失败时第 3 次成功，一直失败时 5 次后步骤失败。`CODING_STANDARDS.md` 的 GitHub Workflow 节同步写明。提交钩子限制单个文件 20000 字节，`tests/releaseGate.test.cjs` 加上这些测试后超了，所以把 `workflow`、`runStep`、`assertRestoreAndSave`、`posixPath`、`asList` 移到 `tests/helpers/workflowSteps.cjs`，两个测试文件共用。
- 已被取代（2026-11-09，见末尾“构建 job 也跳过 postinstall 下载”）：~~`build.yml` 的 `Install dependencies` 仍在 postinstall 里下载 Electron，没有改。~~

## 2026-11-09 构建 job 也跳过 postinstall 下载，打包缓存按版本定 key，main 上预热

- 起因：Renovate PR #139 的 Smoke Test 运行 [`42569356351`](https://github.com/JayYa/fntv-electron/actions/runs/42569356351) 的 build job 反复失败于 GitHub 下载 504：Windows 在 `pnpm install` 的 electron postinstall（上一节只改了 `ci.yml`）；Linux、macOS 在 electron-builder 打包时。第 3 次尝试里 macOS 仍失败：`packaging-macOS-*` 未命中（key 用锁文件 hash，依赖 PR 每次都变），日志先是 `downloaded label=electron progress=100%`，约 23 秒后 504，没有 URL。
- 共用安装：新增 composite action `.github/actions/install-dependencies`，即上一节 `ci.yml` 的安装、缓存和下载步骤，`ci.yml`、`build.yml` 都调用它，超时写在调用步骤上（composite 步骤不支持 `timeout-minutes`）。`tests/standards.test.cjs` 的 workflow 规则也检查它。
- 缓存 key：`scripts/ci-download-cache.cjs keys` 从 `package.json` 读 `electron`、`electron-builder` 的固定版本（不是固定版本时报错），从锁文件读唯一的 `app-builder-lib` 版本。Electron key 改为 `electron-<os>-<electron 版本>`。安装依赖前也能算。
- 已被取代（2026-11-10，见 [CI 缓存额度与清理](ci-cache-quota.md)）：~~打包 key 为 `packaging-<os>-electron-<版本>-electron-builder-<版本>-app-builder-lib-<版本>`，`restore-keys` 依次是同一 Electron 版本、同一平台的前缀。~~
- 打包前 `prepare-packaging`：删掉从旧 key 恢复带进来的其它 Electron 版本的 zip，免得越存越大；从 `node_modules/electron/checksums.json` 写 `SHASUMS256.txt-<版本>` 到 `@electron/get` 默认目录。原因：`app-builder-lib/node_modules/@electron/get`（3.1.0）`dist/cjs/index.js` 的 `downloadArtifact` 命中缓存后仍调 `validateArtifact`，没有 `checksums` 时用 `cacheMode: Bypass` 联网下载 `SHASUMS256.txt`，缓存全命中也要联网。`app-builder-lib@26.18.0` 的 `out/util/electronGet.js` 的 `resolveSeededChecksums` 读缓存根目录的 `SHASUMS256.txt-<版本>`，有对应条目时作为 `checksums` 离线校验。本地实测写入后 `buildElectronArtifactConfig` 返回的配置带上了 `checksums`。上面 macOS 的 504 是不是这个请求，没有核实。
- 打包下载的重试：`electronGet.js` 的 `downloadArtifactToFile` 对 Electron zip 和打包工具都只重试 3 次（`interval` 2000、`backoff` 2000 毫秒），写死，没有配置项或环境变量。`build.electronDownload` 能传 `downloadOptions` 给 got 11，但 `GotDownloader` 用 `got.stream`，got 11 的 `retry` 对 stream 不生效，没有用。所以在 `Build application` 外层重试：日志有 5xx 或网络错误（匹配模式见 `build.yml`）时整条打包命令重跑，共 3 次，间隔 30、60 秒，其它错误直接失败。步骤超时 15 → 30 分钟，job 30 → 45 分钟。
- main 上预热：缓存按 ref 隔离，PR 只能读自己的和 base 分支的；`ci.yml` 只在 `pull_request` 上跑，main 上只有发版时构建。没有给 `ci.yml` 加 `push: main`：每次合并都要跑三平台 Test，且预热不了打包缓存。新增 `cache-warm.yml`：push 到 main 且改了 `package.json`、锁文件、`build.yml`、action 或脚本时，每周一（补 7 天没读被清掉的缓存），或手动触发。先用 `gh api repos/<仓库>/actions/caches`（`actions: read`）查 main 上每个平台的两个 key，缺的平台才调 `build.yml` 打包一次（`build.yml` 新增输入 `upload`，这里传 `false`，不上传安装包）。成本：仓库是公开的，GitHub 托管的标准 runner 不计费；按 `42569356351` 的 build job 各约 4 分钟算，版本变化时约 13 个 runner 分钟，版本不变时只跑一次查询 job。
- 测试：`tests/ciElectronDownload.test.cjs` 改为检查 action 和两处调用；新文件 `tests/buildDownloads.test.cjs` 检查 key、`prepare-packaging`、打包重试（桩 `pnpm`）和 `cache-warm.yml` 只构建缺缓存的平台（桩 `gh`），原 `tests/releaseGate.test.cjs` 的打包缓存测试移来。

## 2026-11-09 #146 合并后验证：main 上预热成功，PR 复用 main 的缓存（`998b188`）

- #146 合并为 `998b188`。main 上 `Warm download caches`（`cache-warm.yml`）第一次运行（commit `998b188`）三个平台都成功。之后 main 上有这些缓存：`electron-<os>-38.8.6`、`packaging-<os>-electron-38.8.6-electron-builder-26.18.0-app-builder-lib-26.18.0`、`mpv-archive-<os>-783cc16d…`，以及 `setup-go`、`node-cache` 的缓存。
- 维护者在 Dependency Dashboard（#128）勾选 rebase all 后，#139、#141、#144、#147、#134 由 Renovate 重建，CI 和冒烟测试全绿。抽查 #139、#147 的 Windows 构建日志：上面几个缓存都是 `Cache restored from key`，打包日志是 `using cached artifact`，即 PR 复用了 main 的缓存。macOS、Linux 的构建日志没有抽查。
- 之后 `cache-warm.yml` 在 `a23cbb4`、`4fe1c1f`、`d5091bc` 的 push 上都运行成功。

## 2026-11-09 Electron 45 下的下载机制和安装 action 的调整（PR #149）

- 核实（读 `electron@45.2.3` 的 `install.js`、`index.js`、`cli.js`、`package.json`）：没有 `postinstall`，`pnpm install` 不下载，也不再读 `ELECTRON_SKIP_BINARY_DOWNLOAD`。`install.js` 还在（`bin` 名 `install-electron`），逻辑同前：`dist/version`、`path.txt`、可执行文件都对得上就以 0 退出，否则用 `@electron/get` 5.1.0 下载、`@electron-internal/extract-zip`（原生绑定）解压，最后写 `path.txt`。`index.js` 在 `path.txt` 或可执行文件不在时同步运行一次 `install.js`，失败抛 `Electron failed to install correctly`，不重试。`@electron/get` 5 用 `fetch`，没有重试；缓存目录仍是 `env-paths('electron').cache`（三个平台与 38 相同），`install.js` 传 `cacheRoot: electron_config_cache`；镜像读 `ELECTRON_MIRROR`、`npm_config_electron_mirror` 等。
- 结论：不预先下载时，`tests/accessCodeSession.test.cjs` 的顶层 `import` 会走无重试的按需下载，所以安装 action 仍在测试和打包之前带缓存、重试运行 `install.js`。改动：去掉无效的 `ELECTRON_SKIP_BINARY_DOWNLOAD`；下载步骤加 `DEBUG: '@electron/get:*'`，日志里有 `Cache hit`/`Cache miss`；末尾再查 `dist/version`。缓存 key `electron-<os>-<版本>` 随版本变，路径不变。`build-and-smoke.yml` 的同名变量也删掉，冒烟测试不 `require('electron')`。
- 测试：`tests/ciElectronDownload.test.cjs` 核对 electron 包没有安装脚本、`install.js` 还在、workflow 里没有 `ELECTRON_SKIP_BINARY_DOWNLOAD`；`tests/standards.test.cjs` 的 `electron finished extracting its binary` 改为子进程 `require('electron')`，核对可执行文件和 `dist/version`。本地移走 `dist`、`path.txt` 后 `require('electron')` 确实按需重新下载解压。
- 验证（#149 第一次推送 `66bef9d`，CI [`42581937229`](https://github.com/JayYa/fntv-electron/actions/runs/42581937229)、Smoke Test [`42581937469`](https://github.com/JayYa/fntv-electron/actions/runs/42581937469)，全绿）：三平台 build job `electron-<os>-45.2.3` 都未命中，`Cache miss` 后下载并保存；Linux build 第 1 次 `HTTPError: Response code 504`，`retrying in 15s` 后第 2 次成功，重试路径真的走到了。Test job 里 macOS、Windows 命中同次运行 build job 刚存的缓存（`Cache restored from key`、`Cache hit`），Linux 比 build 早，未命中直接下载。打包缓存从 `packaging-<os>-electron-38.8.6-…` 经 `restore-keys` 恢复，Linux、macOS 打包重新下载 45 的 zip，三平台都存了 `packaging-<os>-electron-45.2.3-…`。`DEBUG` 也打出了整份 `checksums`（约 100 行），可接受。
