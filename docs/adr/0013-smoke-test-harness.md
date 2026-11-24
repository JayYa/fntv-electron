---
status: accepted
---

# 冒烟测试框架与平台约束

`tests/smoke/installer.smoke.cjs` 用 `playwright-core` 启动客户端，只观察窗口、页面、进程和日志，不引入任何源码。安装包模式（`build-and-smoke.yml`）和未打包模式（`ci.yml` 的 `Launch unpackaged app`，通过 `FNTV_SMOKE_APP_DIR` 启动 `electron <目录>`）共用同一套断言，只对安装包成立的断言在未打包模式下跳过。运行方式和环境变量见 `tests/smoke/README.md`，发版门禁见 [ADR-0003](0003-release-gate.md)。

## 目标平台与 workflow 同步

`tests/smoke/targets.cjs` 是冒烟测试目标平台的唯一来源。新增平台或架构时在这里加一项，并同步 workflow 里的三处，漏改任何一处 `tests/releaseGate.test.cjs` 都会失败：

- `build-and-smoke.yml` 的 `select-targets`：平台的构建机器和冒烟目标；
- `release.yml` 的 `Select platforms`、`workflow_dispatch` 选项，以及 `publish` 的 `Check release assets` 安装包名；
- `smoke-test.yml` 的平台列表和 `workflow_dispatch` 选项。

`findInstaller` 要求目录里有且只有一个匹配的安装包，找到 0 个或多个都报错，避免误测到旧版本残留。

## 各平台安装与数据隔离

### macOS

- 挂载 DMG 时用 `-mountpoint` 挂到自己的临时目录，不进 `/Volumes`，避免与同名卷或构建残留冲突。挂载后的根目录里有且只有一个 `.app`，Electron 应用的 `Contents/MacOS` 下只有主可执行文件。
- 环境变量在 `HOME`、`XDG_*` 之外另设 `CFFIXED_USER_HOME`，让 Foundation 的目录查询（Electron 默认 `userData` 依赖它）也落在临时目录。
- `darwin-x64` 在 GitHub 托管的 Intel 机器（`build-and-smoke.yml` 中使用 `macos-26-intel` runner）上原生运行。此前在 Apple Silicon 的 `macos-latest` 上经 Rosetta 运行时首次转译耗时不定（#92 约 50 秒，后来 28 到 116 秒），正式测试前的 120 秒预热仍偶发超时；2026-11-10 改到 Intel 机器后不再需要 Rosetta 和预热。如果 GitHub 不再提供 Intel macOS 镜像，回到 `macos-latest` 并从提交 `33cf286` 恢复预热（`targets.cjs` 的 `warmup`、`installer.smoke.cjs` 的 `warmUp()` 与调用、`build-and-smoke.yml` 中原有的 `Install Rosetta` 步骤、`tests/smokeTargets.test.cjs` 的预热测试，以及将硬件架构检查改回只查 `process.arch`）。
- 架构断言在 macOS 上通过 `sysctl -in hw.optional.arm64` 确认宿主机硬件架构，保证原生运行：Apple Silicon 上返回 `1`（Rosetta 转译的进程读到的也是 `1`），Intel 机器没有该键，`-i` 让输出为空。

### Windows

- `electron-builder` 的 NSIS 安装包以 `appId` 的 UUID v5 作为卸载注册表项名，命名空间取自 `app-builder-lib` 的 `NsisTarget`（`ELECTRON_BUILDER_NS_UUID` = `50e065bc-3134-11e6-9bab-38c9862bdaf3`）。相同 `appId` 的安装包会先静默卸载本机已装的那份，测试结束的卸载还会删掉同名快捷方式。CI 机器是一次性的，不拦截；本地若检测到注册表项则拒绝安装，除非改用测试专用 `appId` 或显式设置 `FNTV_SMOKE_ALLOW_INSTALL=1`。
- 静默安装参数为 `/S /currentuser /D=<目录>`：NSIS 要求 `/D` 必须是最后一个参数且路径不加引号。若安装目录内容不符合预期（不是一个主程序加一个卸载程序），因为安装已写入注册表和快捷方式，必须先执行卸载再报错。
- 静默卸载传 `_?=<目录>` 让卸载程序在原地同步运行，否则它会复制到临时目录后立即返回；卸载程序不会删除自身，随后由测试删除安装目录。
- 环境变量设 `USERPROFILE` 以隔离 `os.homedir()` 下的 MPV 用户配置。Windows 按 `%USERPROFILE%\AppData\Roaming` 解析漫游 AppData，目录不存在时 `app.getPath('appData')` 会失败，因此启动前先建好该目录。
- 日志器曾在 `config.ts` 修改 `userData` 之前取目录，导致日志落进 Electron 默认 `userData`（#87，见 [ADR-0011](0011-platform-behavior-facts.md)）。Windows 上 `app.getPath('home')` 不认 `USERPROFILE`，用 `--user-data-dir` 会让默认 `userData` 与 `~/.fntv` 重合，查不出取早了的问题。因此安装包模式在 CI 上（`CI=true`）不传 `--user-data-dir`，直接用 runner 真实用户目录，启动前确认两个目录都不存在，结束后删除；本地以及未打包模式（`appDir` 非空，不检查该条断言）统一用 `--user-data-dir` 隔离到临时目录，不把 `CI` 传给 `windowsIsolation`。

### Linux

- 直接运行用户下载的 AppImage；CI artifact 下载后会丢失可执行位，安装步骤用 `chmod 0o755` 补上。
- `linux-arm64` 的安装、隔离和日志位置与 `linux-x64` 相同，仅安装包架构名为 `arm64`（`linux-x64` 为 `x86_64`）；它在原生 arm64 机器上运行，若 Proxy 二进制架构不对则启动失败，由 Proxy 健康检查断言发现。

## Playwright 启动与断言约束

- 启动时把 `cwd` 设为临时目录，模拟从桌面图标启动，不依赖仓库工作目录。
- 主进程在 `new BrowserWindow` 同步执行期间收到的 `app.evaluate` 会因 `Resulting promise was garbage collected` 失败，因此必须等 `app.firstWindow()` 返回后再在主进程安装 `uncaughtException` / `unhandledRejection` 监听。更早的异常只能依赖捕获到的 stderr 文本（`UNCAUGHT_PATTERN`）；而主进程在窗口出现前抛异常时 Electron 默认弹错误框，不一定打印可匹配文字，因此窗口超时报错时附上主进程输出末尾以便排查。
- 登录页断言检查 `#versionText` 显示打包版本号：版本号由主进程经 preload 发给页面，显示正确说明 preload 和 IPC 链条工作正常。
- Proxy 没有独立日志文件，其日志经 IPC 由主进程以 `[Proxy]` 前缀写入 `app.log`，测试结束时从中提取生成 `proxy.log`。退出后检查 Proxy 停止时，若前面的在线检查未能拿到端口则直接失败，不去探测猜测的端口。
- `window-all-closed` 监听断言防止重复注册（#76）：Electron 在加载客户端代码前会在 `lib/browser/init.ts` 注册一个默认监听（仅当它是唯一监听时调用 `app.quit()`）。测试通过函数源码匹配 `listenerCount('window-all-closed')`（Electron 45 起事件名使用反引号）将其排除；认不出时不静默忽略而是计入客户端监听，宁可断言失败也不漏掉重复监听。
- 主进程未捕获异常断言会等到启动后至少 8 秒再检查，覆盖启动 3 秒后的首次自动检查更新。
- 探测 Proxy 在线用不带 `session` 的 `/api/v1/playvideo/<id>`：Proxy 返回 400，不碰 NAS，有 HTTP 响应就说明它在监听。Windows 上 kill 只结束客户端主进程，Proxy 子进程会留下来锁住安装目录、占着端口，所以结束客户端时用 `taskkill /T /F` 结束整个进程树（`tests/smoke/probes.cjs`）。
- `ci.yml` 的 `Launch unpackaged app` 用默认条件 `success()`：`pnpm run check` 失败时不再启动，免得在没编译好的 `dest/` 上报出误导的错误（`tests/unpackagedLaunch.test.cjs`）。
- GitHub 只认从行首开始的 annotation。默认 reporter 随 Node 版本和输出是否是终端而变，CI 上的 TAP 会在测试输出前加 `# `，所以 `test:smoke` 固定 reporter。`tests/smokeAnnotations.test.cjs` 在子进程里验证时去掉外层 `node --test` 设的 `NODE_TEST_CONTEXT`，否则子进程改用内部格式输出。
- Proxy 的实际端口取自主进程写的“Proxy 已就绪，端口 N”这一行（`tests/smoke/probes.cjs` 的 `PROXY_READY_PATTERN` 按原文匹配），改 `src/main/common/proxy.ts` 的措辞要同步改那边。
- 未打包模式的 Electron 可执行文件由 `scripts/smoke-unpackaged.cjs` 解析好，经 `FNTV_SMOKE_EXECUTABLE` 传给 `tests/smoke/launch.cjs`：安装包冒烟 job 只装 `playwright-core`（`scripts/install-smoke-deps.cjs`），`launch.cjs` 不能加载 electron 包。未打包时日志不随 HOME 隔离，启动前清空 `log/`，免得读到上一次运行的“Proxy 已就绪”和图标路径。
- 主窗口图标能否加载由冒烟测试检查：主进程启动时记一行“主窗口图标: <路径>”，测试从这行读出路径（`tests/smoke/installer.smoke.cjs`）。
- 本机按用户装过的正式客户端，卸载注册表项名是 `b80d411a-9a19-5c6b-8319-e74d5c792871`（在装有 2.7.1 的 Windows 上用 `reg query` 看到的值），`tests/smokeTargets.test.cjs` 用它当作已装的客户端，核对本地拒绝安装；本地构建改了 `appId`（`tests/smoke/README.md` 的“在本地跑”），GUID 不同，碰不到已装的客户端。
