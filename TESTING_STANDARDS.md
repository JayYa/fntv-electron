# 测试标准

## 运行

- `pnpm test`：编译到 `dest/` 后运行全部 `tests/*.test.cjs`。
- `pnpm run compile`：先清空 `dest/` 再运行 `tsc`，然后打包 preload 到 `dest/preload/bundle.js`，已删除源文件的旧 js 不会留下来被 `readdirSync` 加载。`tsBuildInfoFile` 要留在 `dest/` 里，放到外面时 `tsc` 会认为无需输出，留下空目录。`pnpm run watch` 同时运行 `tsc --watch` 和 esbuild 监听，不清理，删过文件后跑一次 `compile`。
- `go test ./...`：改 Go 代码时在 `src/modules/proxy` 下运行。
- `pnpm run lint`：用 ESLint 检查 `src/**/*.ts` 和 `resource/login/*.js`，规则在 `eslint.config.mjs`。
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

`tests/smoke/` 把安装包当黑盒：按用户的方式装好或打开，用 `playwright-core` 的 `_electron` 启动，检查主窗口可见、登录页表单和版本号显示、Proxy 通过 `/health`、主进程没有未捕获异常，最后退出客户端并确认 Proxy 也退出。测试不引入源码，`pnpm test` 不包含它。

- `tests/smoke/targets.cjs` 列出目标平台（id 是 `<process.platform>-<process.arch>`，如 `linux-x64`、`darwin-arm64`、`win32-x64`，测试默认取当前机器）：安装包名、安装方式、用户数据隔离方式。断言在 `tests/smoke/installer.smoke.cjs`，所有目标共用。加平台时在 `targets.cjs` 加一项，再在 `build-and-smoke.yml` 的 `select-targets` 和 `smoke-test.yml` 的平台列表里加上。
- 用户数据放在临时目录：Linux 和 macOS 改 `HOME` 和 `XDG_*`。Windows 上 `app.getPath('home')` 不认 `USERPROFILE`，改用启动参数 `--user-data-dir` 指定 `~/.fntv` 的位置（`src/public/constants.ts`），日志也随之写在它的 `logs/` 下；`USERPROFILE` 只用来隔离 MPV 用户配置。
- 截图、主进程输出、应用日志写到 `smoke-artifacts/<目标>/`：`screenshot.png`、`main-process.log`（Electron 进程的 stdout 和 stderr）、`logs/`（应用日志目录的副本，Linux 上是 `~/.config/fntv/logs`，不在 `~/.fntv` 里）、`proxy.log`。Proxy 没有自己的日志文件，它的输出由主进程写进 `app.log`，`proxy.log` 是从中挑出的非 Electron 格式的行和 `Proxy stderr` 行。
- 端口 22345 被占用时测试直接失败，本地跑之前先关掉正在运行的客户端。
- 在主进程里执行代码（`app.evaluate`）前先等 `app.firstWindow()`。客户端启动时创建主窗口期间收到的 `app.evaluate` 会以 `Resulting promise was garbage collected` 失败，主窗口页面出现后就不会了。
- macOS：`darwin-arm64` 和 `darwin-x64` 用 `hdiutil attach -nobrowse` 把 dmg 挂到临时目录，启动里面 `.app` 的可执行文件，测试结束后 `hdiutil detach`，CI 上另有一步检查 dmg 已卸载。两个都在 Apple Silicon 的 `macos-latest` 上跑，x64 包经 Rosetta 运行，`process.arch` 断言证明客户端是 x64 进程。用户数据隔离另加 `CFFIXED_USER_HOME`，日志在 `~/Library/Application Support/fntv/logs`。

### 在 CI 上跑

`smoke-test.yml` 调用可复用的 `build-and-smoke.yml`：先用 `build.yml` 构建（发版也用这一份），再下载构建 artifact 跑测试，截图和日志上传为 `smoke-<目标>`，保留 14 天，失败时也上传。触发条件：手动触发（可选平台）、Release PR、改了 `tests/smoke/`、这三个 workflow 或 `package.json` 的 PR。

Linux 构建 job 在 x64 机器上一次构建出 x64 和 arm64 两个 AppImage，`linux-arm64` 的冒烟 job 在原生 `ubuntu-24.04-arm` 机器上下载同一个 `linux-build` artifact 运行，不用 QEMU，也不在 arm 机器上重新构建。

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

本机已经装了客户端时，不要直接装测试用的安装包：安装标识由 `appId` 决定，相同时安装程序会先卸载已有的那份，快捷方式名由 `productName` 决定，卸载时会删掉同名快捷方式。本地构建时改掉这两项，产物名不变，测试照样找得到：

```bash
pnpm run build:proxy:win && pnpm run compile
npx electron-builder --win --publish never -c.appId=com.qiaokes.fntv.smoketest -c.productName=FNMediaSmoke
```

CI 装了 `libfuse2t64`，AppImage 通过 FUSE 挂载运行。本地用 Docker 时也走这条路：容器加 `--device /dev/fuse --cap-add SYS_ADMIN --security-opt apparmor:unconfined`，装 `libfuse2t64`。`APPIMAGE_EXTRACT_AND_RUN=1` 先解压再运行，不需要 FUSE，但从解压目录读文件比从 FUSE 挂载快，启动时序和 CI 不同，和时序有关的问题可能在本地复现不出来。

`FNTV_SMOKE_INSTALLER_DIR` 改安装包目录（默认 `release/`），`FNTV_SMOKE_EXECUTABLE` 跳过安装直接启动某个可执行文件，`FNTV_SMOKE_ARTIFACTS` 改输出目录。

## 配置和工作流

- 配置类改动用 `git grep` 做静态验收，结果只能剩下有意保留的内容。能写成断言的放进 `tests/standards.test.cjs`。
- 工作流改动要有真实运行记录作为证据，只读 YAML 不算验证。

## Go

- 路由和处理器用 `httptest` 断言响应（`src/modules/proxy/internal/logic/register_test.go`）。
