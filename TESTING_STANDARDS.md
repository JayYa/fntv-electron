# 测试标准

## 运行

- `pnpm test`：编译到 `dest/` 后运行全部 `tests/*.test.cjs`。
- `pnpm run compile`：先清空 `dest/` 再运行 `tsc`，然后打包 preload 到 `dest/preload/bundle.js`，已删除源文件的旧 js 不会留下来被 `readdirSync` 加载。`tsBuildInfoFile` 要留在 `dest/` 里，放到外面时 `tsc` 会认为无需输出，留下空目录。`pnpm run watch` 同时运行 `tsc --watch` 和 esbuild 监听，不清理，删过文件后跑一次 `compile`。
- `go test ./...`：改 Go 代码时在 `src/modules/proxy` 下运行。
- `pnpm run lint`：用 ESLint 检查 `src/**/*.ts`、`resource/login/*.js` 和 `tests/**/*.cjs`，规则在 `eslint.config.mjs`。
- CI 在 Windows、macOS 和 Linux 上各跑一遍这三项（`.github/workflows/ci.yml`）。

### `Electron failed to install correctly`

`tests/accessCodeSession.test.cjs` 在加载时报这个错，说明 `node_modules/electron/dist` 不完整。这是环境问题。先确认 `pnpm-workspace.yaml` 的 `allowBuilds` 有 `electron`、`overrides` 有 `extract-zip>yauzl`，再删掉 `node_modules` 重新 `pnpm install`。`node_modules/electron/path.txt` 存在才算解压完成，`electron postinstall: Done` 证明不了。

## `tests/*.test.cjs` 写法

- 用 CommonJS、`node:test` 和 `node:assert/strict`。
- 从 `../dest/...` 引入编译产物，单独运行前先 `pnpm run compile`。
- 测试名用一句英文写清行为，例如 `first initialization does not overwrite pre-existing user state`。
- 用到文件系统时，在 `fs.mkdtempSync(path.join(os.tmpdir(), ...))` 里操作，并用 `t.after` 清理（`tests/mpvConfigMigration.test.cjs`）。
- 模块支持注入依赖时，直接传假对象（`establishAccessCodeSession` 的 `gatewaySession`、`requester`）。
- 模块直接使用 Electron API 时，替换 `Module._load` 返回 `electron` 的假对象，结束后恢复（`tests/helpers/credentialConfig.cjs`）。
- CI 在 Windows、macOS 和 Linux 上都跑，Electron 假对象要包含各平台分支用到的 API，例如 Linux 才调用的 `safeStorage.getSelectedStorageBackend`。只在本机 Windows 通过不算通过。
- 更新检查的测试替换 `axios.get` 返回 GitHub 响应，HTTP 错误用真实的 `axios.AxiosError` 构造（`tests/updateChecker.test.cjs`）。

## 只测外部行为

- 断言公开入口的输入、输出和落盘结果，不绑定内部函数和调用顺序。例如 `synchronizeMpvConfig` 的测试只看返回值和目录内容。
- 测试走模块已有的公开入口或依赖参数，不为测试新增接缝。
- 文本断言只用于没有运行入口的内容：`resource/login/` 下的页面、样式、脚本和窗口安全选项（`tests/rendererIsolation.test.cjs`）。
- 测试失败时先判断是行为回归还是测试过期，只有测试过期才改断言。

## 冒烟测试

`tests/smoke/` 把安装包当黑盒：按用户的方式装好或打开，用 `playwright-core` 的 `_electron` 启动，检查主窗口可见、登录页表单和版本号显示、Proxy 通过 `/health`、主窗口图标能用 `nativeImage` 加载（#74）、客户端只有一个 `window-all-closed` 监听（#76，不算 Electron 在 `lib/browser/init.ts` 自带的那个）、主进程没有未捕获异常，最后退出客户端并确认 Proxy 也退出。测试不引入源码，`pnpm test` 不包含它。

- `tests/smoke/targets.cjs` 是目标平台的唯一来源（id 是 `<process.platform>-<process.arch>`，如 `linux-x64`、`darwin-arm64`、`win32-x64`，测试默认取当前机器）：在哪个 workflow 平台构建、安装包名、安装方式、用户数据隔离方式。断言在 `tests/smoke/installer.smoke.cjs`，所有目标共用。加平台时在 `targets.cjs` 加一项，再同步 `build-and-smoke.yml` 的 `select-targets`、`release.yml` 的 `Select platforms` 和 `Check installers`、`smoke-test.yml` 的平台列表，以及两个 workflow 的手动触发选项。漏改哪一处，`tests/releaseGate.test.cjs` 都会失败。
- 用户数据放在临时目录：Linux 和 macOS 改 `HOME` 和 `XDG_*`。Windows 上 `app.getPath('home')` 不认 `USERPROFILE`，本地改用启动参数 `--user-data-dir` 指定 `~/.fntv` 的位置（`src/public/constants.ts`）；`USERPROFILE` 只用来隔离 MPV 用户配置。
- 日志应写在 `~/.fntv/logs`。测试检查 `app.log` 在那里，Electron 默认 userData（Linux 是 `~/.config/fntv`，macOS 是 `~/Library/Application Support/fntv`，Windows 是 `%APPDATA%ntv`）下没有 `logs/`（#87）。带 `--user-data-dir` 时 Electron 把默认 userData 也改到同一目录，这条检查不出问题，所以 Windows 在 CI 上（`CI=true`）不带这个参数，直接用 runner 的真实用户目录，测试前确认 `~/.fntv` 和 `%APPDATA%ntv` 都不存在，测试后删掉。本地 Windows 跑时这一条显示为 skip（`targets.cjs` 的 `windowsIsolation`）。
- 截图、主进程输出、应用日志写到 `smoke-artifacts/<目标>/`：`screenshot.png`、`main-process.log`（Electron 进程的 stdout 和 stderr）、`logs/`（`~/.fntv/logs` 的副本）、`proxy.log`。Proxy 没有自己的日志文件，它的输出由主进程写进 `app.log`，`proxy.log` 是从中挑出的非 Electron 格式的行和 `Proxy stderr` 行。
- 端口 22345 被占用时测试直接失败，本地跑之前先关掉正在运行的客户端。
- 在主进程里执行代码（`app.evaluate`）前先等 `app.firstWindow()`。客户端启动时创建主窗口期间收到的 `app.evaluate` 会以 `Resulting promise was garbage collected` 失败，主窗口页面出现后就不会了。
- 主进程异常监听在主窗口出现后才装上。更早的异常只能靠 stderr 里的文字发现，而 Electron 默认弹错误框，不一定打印出来，这是已知盲区：表现为主窗口 30 秒内没出现，报错附有主进程输出的末尾，再看 `logs/app.log`。
- macOS：`darwin-arm64` 和 `darwin-x64` 用 `hdiutil attach -nobrowse` 把 dmg 挂到临时目录，启动里面 `.app` 的可执行文件，测试结束后 `hdiutil detach`，CI 上另有一步检查 dmg 已卸载。两个都在 Apple Silicon 的 `macos-latest` 上跑，x64 包经 Rosetta 运行，`process.arch` 断言证明客户端是 x64 进程。用户数据隔离另加 `CFFIXED_USER_HOME`，Electron 默认 userData 也随之落在临时目录。
- `darwin-x64` 在正式测试前先预热启动一次（`targets.cjs` 的 `warmup`）：不经 Playwright 直接启动客户端，用单独的临时用户数据目录，等 stderr 出现 `DevTools listening` 后杀掉进程组，确认客户端退出、端口 22345 不再响应，耗时打成 `::notice::`，预热超时或失败时测试直接失败。原因是 Rosetta 第一次运行 x64 Electron 要先转译：#92 在同一台 `macos-latest` 上连续直接启动 3 次，`darwin-x64` 到 `DevTools listening` 分别是 51952ms、5552ms、6733ms，转译缓存 `/var/db/oah` 从 2.7M 涨到 255M；`darwin-arm64` 是 2304ms、192ms、216ms，缓存不变。约 50 秒的一次性转译加上 Playwright 的开销会贴着或超过 `electron.launch` 的 60 秒超时。预热上限 120 秒，正式测试的超时和断言不变。

### 在 CI 上跑

`smoke-test.yml` 调用可复用的 `build-and-smoke.yml`：先用 `build.yml` 构建（发版也用这一份），再下载构建 artifact 跑测试，截图和日志上传为 `smoke-<目标>`，保留 14 天，失败时也上传。触发条件：手动触发（可选平台）、改了 `tests/smoke/`、这三个 workflow 或 `package.json` 的 PR。

Release PR 也走 `smoke-test.yml`：release-please 用 GITHUB_TOKEN 开的 PR 会触发 `pull_request` workflow，但结论是 `action_required`，维护者在 PR 上点 “Approve workflows to run” 后才跑（`docs/wiki/release-and-update.md` 2026-11-07 v2.7.0 验收；#70 批准后 `actions/runs/42455333345` 通过）。Release PR 总会改 `package.json`，批准后 `smoke-test.yml` 测 5 个目标，结果直接显示在 PR 上。`release.yml` 不对 Release PR 构建（2026-11-08 维护者决定，见 `docs/wiki/multi-platform-testing.md`）。合并 Release PR 前先批准并等这些检查通过。

发版门禁：`release.yml` 也调用 `build-and-smoke.yml`，三个平台各一份，`publish` 要等它们全部成功才上传安装包、把 draft Release 转为正式，任何一个目标失败 Release 就停在 draft。上传的就是冒烟测试下载的那份 `<platform>-build` artifact，不另外构建。手动触发 `release.yml` 只构建和跑冒烟测试，不发布。这些依赖关系由 `tests/releaseGate.test.cjs` 读 workflow 文件检查，改 `release.yml` 的 job 时先跑它。

### 发版门禁失败后

合并 Release PR 的那次运行里，release-please 已经建好 draft Release 并打了 tag，之后才构建和测试。冒烟测试失败时 Release 停在 draft，先看失败目标的 `smoke-<目标>` artifact 判断原因：

- 偶发失败（runner 故障、网络、超时抖动）：在同一次运行上点 Re-run failed jobs。release-please 的输出会保留，构建 artifact 保留 30 天，重跑通过后 `publish` 照常发布。
- 真实缺陷：这个版本号不能再用。删掉 draft Release 和它的 tag（`gh release delete vX.Y.Z --cleanup-tag`），用 `fix` 提交修复并合并到 `main`，release-please 会开下一个版本的 Release PR，合并后发那个版本。不要改 `package.json` 或 `.release-please-manifest.json` 回退版本号。

`test:smoke` 固定用 `spec` reporter：Node 22 在非终端下默认是 TAP，会在测试打印的每行前加 `# `，`::notice::` 之类的注解就不会被 GitHub 识别。

Linux 构建 job 在 x64 机器上一次构建出 x64 和 arm64 两个 AppImage，`linux-arm64` 的冒烟 job 在原生 `ubuntu-24.04-arm` 机器上下载同一个 `linux-build` artifact 运行，不用 QEMU，也不在 arm 机器上重新构建。本地跑不了 `linux-arm64`，见下面“在本地跑”。

```bash
gh workflow run smoke-test.yml -f platform=linux
gh run download <run-id> -n smoke-linux-x64
```

### 在本地跑

先构建对应平台的安装包（`pnpm run build:linux:x64`），再在同一平台上运行。Linux 没有显示器时用 `xvfb-run`：

```bash
FNTV_SMOKE_TARGET=linux-x64 xvfb-run -a pnpm run test:smoke
```

Windows 上先 `pnpm run build:win`，再运行 `pnpm run test:smoke`（目标默认取当前机器，即 `win32-x64`）。测试用 `/S /currentuser /D=<临时目录>` 静默安装，结束后用卸载程序原地卸载并删掉安装目录。

本机已经装了客户端时，不要直接装测试用的安装包：安装标识由 `appId` 决定，相同时安装程序会先卸载已有的那份，快捷方式名由 `productName` 决定，卸载时会删掉同名快捷方式。测试安装前会查注册表，本机装有 `package.json` 里那个 `appId` 的客户端时直接失败（CI 上不查）。本地构建时改掉这两项，产物名不变，测试照样找得到，再设 `FNTV_SMOKE_ALLOW_INSTALL=1` 运行：

```bash
pnpm run build:proxy:win && pnpm run compile
npx electron-builder --win --publish never -c.appId=com.qiaokes.fntv.smoketest -c.productName=FNMediaSmoke
FNTV_SMOKE_ALLOW_INSTALL=1 pnpm run test:smoke
```

CI 装了 `libfuse2t64`，AppImage 通过 FUSE 挂载运行。本地用 Docker 时也走这条路：容器加 `--device /dev/fuse --cap-add SYS_ADMIN --security-opt apparmor:unconfined`，装 `libfuse2t64`。`APPIMAGE_EXTRACT_AND_RUN=1` 先解压再运行，不需要 FUSE，但从解压目录读文件比从 FUSE 挂载快，启动时序和 CI 不同，和时序有关的问题可能在本地复现不出来。

`FNTV_SMOKE_ALLOW_INSTALL=1` 跳过上面的已安装检查，只在确认安装包用的是测试专用 `appId` 时设。`FNTV_SMOKE_INSTALLER_DIR` 改安装包目录（默认 `release/`），`FNTV_SMOKE_EXECUTABLE` 跳过安装直接启动某个可执行文件，`FNTV_SMOKE_ARTIFACTS` 改输出目录。

`linux-arm64` 在本地 x64 机器上用 Docker `--platform linux/arm64` 加 QEMU 跑不起来，不要用它验证，也不要排查：AppImage 在 ELF 头偏移 8 写了魔数 `AI`，binfmt 认不出，直接执行时被当成 shell 脚本（`Syntax error: "(" unexpected`）；清掉这 3 个字节后能启动，但模拟太慢，60 秒内主窗口不出现（2026-11-08，#90）。arm64 只以 CI 的 `ubuntu-24.04-arm` job 为准。

## 配置和工作流

- 配置类改动用 `git grep` 做静态验收，结果只能剩下有意保留的内容。能写成断言的放进 `tests/standards.test.cjs`。
- 工作流改动要有真实运行记录作为证据，只读 YAML 不算验证。

## Go

- 路由和处理器用 `httptest` 断言响应（`src/modules/proxy/internal/logic/register_test.go`）。
