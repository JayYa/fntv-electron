# 冒烟测试

把安装包当黑盒：按用户的方式装好或打开，用 `playwright-core` 的 `_electron` 启动，检查主窗口可见、登录页表单和版本号显示、Proxy 对不带 `session` 的 `playvideo` 请求有 HTTP 响应、主窗口图标能用 `nativeImage` 加载（#74）、客户端只有一个 `window-all-closed` 监听（#76，不算 Electron 在 `lib/browser/init.ts` 自带的那个）、主进程没有未捕获异常，最后退出客户端并确认 Proxy 端口关闭。Proxy 端口由系统分配，测试从 `app.log` 的“Proxy 已就绪，端口 N”读出实际端口再探测。写法约束见 `TESTING_STANDARDS.md` 的“冒烟测试”。

目标 id 是 `<process.platform>-<process.arch>`，如 `linux-x64`、`darwin-arm64`、`win32-x64`，默认取当前机器，用 `FNTV_SMOKE_TARGET` 指定。

## 用户数据隔离

- Linux 和 macOS 改 `HOME` 和 `XDG_*`，macOS 另加 `CFFIXED_USER_HOME`，Electron 默认 userData 也随之落在临时目录。
- Windows 上 `app.getPath('home')` 不认 `USERPROFILE`，本地改用启动参数 `--user-data-dir` 指定 `~/.fntv` 的位置（原因见 `src/public/constants.ts`）。`USERPROFILE` 只用来隔离 MPV 用户配置。
- 日志应写在 `~/.fntv/logs`。测试检查 `app.log` 在那里，Electron 默认 userData（Linux 是 `~/.config/fntv`，macOS 是 `~/Library/Application Support/fntv`，Windows 是 `%APPDATA%\fntv`）下没有 `logs/`（#87）。带 `--user-data-dir` 时两者重合，这条检查不出问题，所以 Windows 在 CI 上（`CI=true`）不带这个参数，直接用 runner 的真实用户目录，测试前确认 `~/.fntv` 和 `%APPDATA%\fntv` 都不存在，测试后删掉。本地 Windows 跑时这一条显示为 skip（`targets.cjs` 的 `windowsIsolation`）。

## 输出和排查

- 截图、主进程输出、应用日志写到 `smoke-artifacts/<目标>/`：`screenshot.png`、`main-process.log`（Electron 进程的 stdout 和 stderr）、`logs/`（`~/.fntv/logs` 的副本）、`proxy.log`。Proxy 没有自己的日志文件，它的日志经 IPC 由主进程写进 `app.log`，`proxy.log` 是从中挑出的带 `[Proxy]` 的行。
- 主进程异常监听在主窗口出现后才装上。更早的异常只能靠 stderr 里的文字发现，而 Electron 默认弹错误框，不一定打印出来，这是已知盲区：表现为主窗口 30 秒内没出现，报错附有主进程输出的末尾，再看 `logs/app.log`。
- `test:smoke` 固定用 `spec` reporter：Node 22 在非终端下默认是 TAP，会在测试打印的每行前加 `# `，`::notice::` 之类的注解就不会被 GitHub 识别。

## macOS

`darwin-arm64` 和 `darwin-x64` 用 `hdiutil attach -nobrowse` 把 dmg 挂到临时目录，启动里面 `.app` 的可执行文件，测试结束后 `hdiutil detach`，CI 上另有一步检查 dmg 已卸载。`darwin-arm64` 在 Apple Silicon 的 `macos-latest` 上跑，`darwin-x64` 在 Intel 的 `macos-26-intel` 上原生运行；`process.arch` 断言证明客户端是目标架构的进程，`sysctl hw.optional.arm64` 证明机器也是这个架构。GitHub 不再提供 Intel macOS 镜像时的退路见 `targets.cjs` 的 `darwin-x64`。

## 在 CI 上跑

`smoke-test.yml` 调用可复用的 `build-and-smoke.yml`：先用 `build.yml` 构建，再下载构建 artifact 跑测试，截图和日志上传为 `smoke-<目标>`，保留 14 天，失败时也上传。触发条件：手动触发（可选平台）、改了 `tests/smoke/`、这三个 workflow、`package.json` 或 `scripts/install-smoke-deps.cjs` 的 PR。发版时的门禁见 `docs/adr/0003-release-gate.md`。

冒烟测试 job 不跑 `pnpm install`：`scripts/install-smoke-deps.cjs` 按 `pnpm-lock.yaml` 的版本和 integrity 只装 `playwright-core`（它没有依赖），测试用 `npm run test:smoke` 运行。这里新 require 一个 npm 包时，要加进脚本的 `SMOKE_PACKAGES`，否则 `tests/smokeDeps.test.cjs` 失败；新包在锁文件里有依赖时脚本报错，要改装法。

Linux 构建 job 在 x64 机器上一次构建出 x64 和 arm64 两个 AppImage，`linux-arm64` 的冒烟 job 在原生 `ubuntu-24.04-arm` 机器上下载同一个 `linux-build` artifact 运行。

```bash
gh workflow run smoke-test.yml -f platform=linux
gh run download <run-id> -n smoke-linux-x64
```

## 在本地跑

本地用 `pnpm install` 装好的 `node_modules`。先构建对应平台的安装包（`pnpm run build:linux:x64`），再在同一平台上运行。Linux 没有显示器时用 `xvfb-run`：

```bash
FNTV_SMOKE_TARGET=linux-x64 xvfb-run -a pnpm run test:smoke
```

Windows 上先 `pnpm run build:win`，再运行 `pnpm run test:smoke`。测试用 `/S /currentuser /D=<临时目录>` 静默安装，结束后用卸载程序原地卸载并删掉安装目录。

本机已经装了客户端时，测试用的安装包要换掉 `appId` 和 `productName`：安装标识由 `appId` 决定，相同时安装程序会先卸载已有的那份；快捷方式名由 `productName` 决定，卸载时会删掉同名快捷方式。测试安装前会查注册表，本机装有 `package.json` 里那个 `appId` 的客户端时直接失败（CI 上不查）。改掉这两项后产物名不变，测试照样找得到，再设 `FNTV_SMOKE_ALLOW_INSTALL=1` 运行：

```bash
pnpm run compile
npx electron-builder --win --publish never -c.appId=com.qiaokes.fntv.smoketest -c.productName=FNMediaSmoke
FNTV_SMOKE_ALLOW_INSTALL=1 pnpm run test:smoke
```

`FNTV_SMOKE_ALLOW_INSTALL=1` 只在确认安装包用的是测试专用 `appId` 时设。`FNTV_SMOKE_INSTALLER_DIR` 改安装包目录（默认 `release/`），`FNTV_SMOKE_EXECUTABLE` 跳过安装直接启动某个可执行文件，`FNTV_SMOKE_ARTIFACTS` 改输出目录。

CI 装了 `libfuse2t64`，AppImage 通过 FUSE 挂载运行。本地用 Docker 时也走这条路：容器加 `--device /dev/fuse --cap-add SYS_ADMIN --security-opt apparmor:unconfined`，装 `libfuse2t64`。`APPIMAGE_EXTRACT_AND_RUN=1` 先解压再运行，不需要 FUSE，但从解压目录读文件比从 FUSE 挂载快，启动时序和 CI 不同，和时序有关的问题可能在本地复现不出来。

`linux-arm64` 只以 CI 的 `ubuntu-24.04-arm` job 为准，本地 x64 机器上的 Docker `--platform linux/arm64` 加 QEMU 跑不起来，不用排查：AppImage 在 ELF 头偏移 8 写了魔数 `AI\x02`，binfmt 认不出，直接执行时被当成 shell 脚本（`Syntax error: "(" unexpected`）；清掉这 3 个字节后能启动，但模拟太慢，60 秒内主窗口不出现（2026-11-08，#90）。
