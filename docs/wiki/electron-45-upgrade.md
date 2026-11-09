# Electron 45 升级评估（Renovate PR #134）

相关：[依赖更新（Renovate）](dependency-updates.md)、[多平台测试策略](multi-platform-testing.md)、[构建依赖与 MPV 插件同步](build-dependencies.md)、[外部运行时归属](../external-runtime.md)。

## 2026-11-09 只读评估 #134（electron 38.8.6 → 45.2.3）

范围：#134（`chore(deps): update dependency electron to v45`，分支 `renovate/electron-45.x`，head `a897b3d`，基于 `b993558`），只改 `package.json` 的 `electron` 和 `pnpm-lock.yaml`。代码行号按本页写作时的 `1e62794`（`chore/remove-unused-deps`）记录，`src` 在 `b993558` 之后没有变化。这次只评估，没有开修复 PR。

### 结论

- 需要配合改动，不能直接合并：五个冒烟测试目标都失败，原因是冒烟测试自己认不出 Electron 45 自带的监听，不是客户端的回归（见“CI 结果”）。改一行测试正则后，Renovate 重建 #134，冒烟测试通过、维护者手测通过后可以合并。
- 不影响合并、但要排期的：`safeStorage` 同步方法在 45 弃用、46 删除（见“逐版本对照”第 45 条），升级 46 前要改成异步方法。
- 面向用户的变化：macOS 最低版本从 12（Monterey）升到 13（Ventura），发版说明里要写。

### CI 结果（`actions/runs/42554730000`，CI 为 `actions/runs/42554729974`）

- 通过：`ci.yml` 三平台 `Test (...)`（含 `tsc`、lint、单元测试）、Conventional Commits、三平台 `build`（electron-builder 26.18.0 打包 `electron=45.2.3`，`@electron/rebuild` 没有要编译的原生依赖）。
- 失败：`linux-x64`、`linux-arm64`、`win32-x64`、`darwin-arm64`、`darwin-x64` 五个冒烟测试目标，每个都是 9 过 1 失败，失败的都是 `keeps a single window-all-closed listener`：“客户端应有 1 个监听，实际是 2 个（含 Electron 自带的共 2 个）”。其余 9 项（主窗口可见、目标架构、登录页表单和版本号、Proxy 健康检查、`~/.fntv/logs/app.log`、默认 userData 下没有日志、主窗口图标、主进程没有未捕获异常、退出时停止 Proxy）都通过。
- 根因：`tests/smoke/installer.smoke.cjs:330` 用 `/listenerCount\(\s*["']window-all-closed["']\s*\)/` 认 Electron 在 `lib/browser/init.ts` 注册的默认监听。Electron 45 打包后这个函数的源码是 ``()=>{Q.listenerCount(`window-all-closed`)===1&&Q.quit()}``，事件名用反引号，正则不认，于是被当成客户端的第二个监听。另一个是客户端唯一的监听 `src/main/main.ts:239`，没有变。同一天 Electron 38 的冒烟测试运行（`actions/runs/42555119338`）这一项通过。
- 配合改动：正则的引号字符类加上反引号（``["'`]``）。改动在 `main` 上，不能推到 `renovate/*` 分支；合并后 Renovate 重建 #134 再跑冒烟测试。
- 冒烟产物里的 `app.log` 记录 `Electron版本: 45.2.3`、`Node.js版本: 24.22.2`（38.8.6 是 22.22.0）。Windows 冒烟产物里有 `初始化MPV配置失败: Failed to get 'appData' path`，Electron 38 的运行（`42555119338`）里同样有，不是这次升级引入的，和冒烟测试的用户目录隔离有关，这次没查。
- 本地验证（`git worktree add` 到临时目录检出 `a897b3d`，Node 26.13.0）：`pnpm install --frozen-lockfile`、`tsc --noEmit` 通过；`pnpm test` 第一次有 1 个断言失败（输出被截断，没看到是哪个测试），之后连跑 3 次都是 351 通过 0 失败，按偶发记。`node_modules/electron/dist` 里是 45.2.3 的二进制。

### 逐版本对照 breaking changes

来源：`electron/electron` 仓库 `docs/breaking-changes.md`（2026-11-09 取，即 electronjs.org/docs/latest/breaking-changes 的原文）。只列和本项目有关、或需要说明为什么无关的条目。

- 39
  - `--host-rules` 弃用：没用到。`src/main/main.ts:15-16` 只加了 `--lang` 和 `--disable-features=VizDisplayCompositor`。
  - `window.open` 弹窗总是可调整大小：主窗口没有 `setWindowOpenHandler`，远程页面 `window.open` 出来的窗口现在一定可调大小，影响很小。OAuth 窗口 `src/main/handlers/core/fnIdOauthWindow.ts:94` 一律 `deny`，不受影响。
  - `desktopCapturer` 要 `NSAudioCaptureUsageDescription`、OSR `paint` 结构变化：没用到。
- 40
  - 渲染进程直接用 `clipboard` 弃用：`src` 和 `resource/login` 里没有 `clipboard`。
  - macOS dSYM 改 `tar.xz`：不用调试符号，无关。
- 41
  - PDF 不再单独建 WebContents：没有 PDF 相关代码。
  - Cookie `changed` 事件的 cause 取值变化：`fnIdOauthWindow.ts:258` 的回调不看 `cause`，只看 `removed`、`cookie.name`、`cookie.value`，不受影响。
  - Linux 对话框 `showHiddenFiles` 弃用：没用到。
- 42
  - macOS 通知改用 `UNNotification`，应用没签名时通知不显示、发 `failed` 事件：受影响的可能性高。`src/main/main.ts:207-218` 的 `showMacNotification`（第一次隐藏到状态栏时的提示）用 `new Notification`，没有监听 `failed`。mac 构建 `CSC_IDENTITY_AUTO_DISCOVERY: false`（`.github/workflows/build.yml:154`），没有开发者证书签名。后果只是这条一次性提示可能不出现，`setTrayNotificationShown(true)` 照样记下，不影响功能。要手测。
  - OSR 默认缩放 1.0：没用 offscreen。
  - `electron` 包不再在 `postinstall` 下载二进制，`ELECTRON_SKIP_BINARY_DOWNLOAD` 不再支持：打包由 electron-builder 自己下载 zip，不受影响（CI 构建通过）。`.github/workflows/build-and-smoke.yml:96` 设的 `ELECTRON_SKIP_BINARY_DOWNLOAD: '1'` 变成无效，冒烟测试本来就用已打包的客户端，无害，可以顺手删。本地 `pnpm start` 第一次运行 `electron .` 时按需下载。`electron` 45 不再依赖 `extract-zip`（改用 `@electron-internal/extract-zip`），PR 后的 lockfile 里已经没有 `extract-zip` 和 `yauzl`，`pnpm-workspace.yaml:10-13` 的 `extract-zip>yauzl` override 和注释失效，可以另行清理；`allowBuilds` 里的 `electron: true` 无害。
  - `clearStorageData` 删除 `quotas`：`src/main/handlers/plugins/login.ts:37` 只传 `storages: ['cookies']`，不受影响。
  - `createFromNamedImage` 的数组 `hslShift` 弃用：没用到。
- 43
  - Linux 无边框窗口默认圆角（`roundedCorners` 默认 `true`）：主窗口在 Windows 和 Linux 上 `frame: false`（`src/main/common/mainwin.ts:21`），Linux 上支持客户端装饰的桌面环境会出现圆角。只是外观，要在 Linux 上看一眼自定义标题栏和窗口边缘。
  - WCO 在 Linux 按系统标题栏布局：没用 `titleBarOverlay`。
  - `NativeImage.toBitmap()` 改 sRGB：没用到，图标只用 `createFromPath`（`src/main/common/tray.ts:270,276`）。
  - 文件对话框不传 `defaultPath` 时默认打开“下载”目录，系统不再记住上次目录：受影响。`src/main/common/tray.ts:71` “设置MPV播放器路径”的 `showOpenDialog` 没传 `defaultPath`，以后每次都从“下载”开始。功能不坏，体验变差；可以另行改成传当前 MPV 路径所在目录。
  - Linux `showHiddenFiles` 删除：没用到。
- 44
  - `select-client-certificate` 的 `webContents` 可能为 `null`，且 `net` 请求也会自动选客户端证书：没有监听这个事件。`src/main/main.ts:45` 监听的是 `certificate-error`，没有变化。
  - 去掉 macOS 12 支持：用户影响，见“工具链和系统版本”。
  - ANGLE 静态链接，不再附带 `libEGL`、`libGLESv2`：项目不替换这两个库；三平台冒烟测试的主窗口都能显示。`webPreferences.webgl: true`（`mainwin.ts:28`）的 WebGL 页面要在手测里顺带看。
  - `net.request` 的 `Sec-Fetch-Dest` 为 frame 类时要 `Sec-Fetch-Mode: navigate`：`src/main/common/accessCodeSession.ts:82` 不设 `Sec-Fetch-*`（`src` 里没有这个字符串），不受影响。
  - 去掉 Unity 支持和 `app.isUnityRunning()`：没用到。
  - 去掉 Windows ia32 和 Linux armv7l：本项目只构建 Windows x64、Linux x64/arm64、macOS x64/arm64（`package.json` 的 `build`），不受影响。
  - 渲染进程不再有 `clipboard`，主进程 `clipboard` 改成 Promise 风格：`src` 里没有 `clipboard`，不受影响。
  - 去掉 `setLoginItemSettings` 的 `openAsHidden` 等：没用开机启动。
- 45
  - 沙箱 preload 去掉 `events`、`timers`、`url` 垫片和 `Buffer`、`setImmediate`、`clearImmediate` 全局：主窗口 `sandbox: true`（`mainwin.ts:33`），preload 是 esbuild 按 `platform: 'browser'` 打的单文件（`scripts/build-preload.cjs`），导入 Node 内置模块会在构建时报错。`src/preload` 没有用 `Buffer`、`setImmediate`、`clearImmediate`；本地打出的 `dest/preload/bundle.js` 里唯一的 `require` 是 `require("electron")`。不受影响。`build-preload.cjs:18` 的 `target: 'chrome140'` 注释还写着 Electron 38，target 比运行时低是安全的，不用改。
  - 沙箱 preload 的 `ipcRenderer` 改用原生 `EventEmitter`：实例方法不变，preload 只用 `ipcRenderer.on/send/invoke`，不受影响。
  - 子框架 worker、DevTools 扩展帧的 preload、`getUserMedia` 桌面源、`contentTracing`、`display-capture` 权限、`requestStorageAccessFor`：都没用到。
  - ASAR 内文件的 fd 只能给 `fs` 用：`src/modules/fn_config/config.ts:224` 的 `fs.openSync` 写的是 userData 下的临时文件；MPV 便携配置和 Proxy 在 `extraFiles`，不在 asar 里（`src/main/common/mpvConfigHelpers.ts:16-18`、`src/public/platform.ts:79`）；Proxy 用 `spawn` 加管道（`src/main/common/proxy.ts:72-73`），不传 fd。asar 里的图标由 `nativeImage` 读，冒烟测试的主窗口图标检查通过。不受影响。
  - 非沙箱窗口 `window.open` 出来的子窗口改成独立沙箱进程：主窗口是沙箱窗口；OAuth 窗口（`fnIdOauthWindow.ts:57-69`）没写 `sandbox`，按默认是沙箱，且弹窗一律 `deny`。不受影响。
  - `safeStorage.isEncryptionAvailable()`、`encryptString()`、`decryptString()` 弃用，46 删除：受影响。用在 `src/modules/fn_config/config.ts:119,125,132,291`（登录凭据加解密和旧配置迁移）。45 上仍能用，只是弃用；升级 46 前必须改成 `isAsyncEncryptionAvailable`、`encryptStringAsync`、`decryptStringAsync`，读配置的调用链要跟着改成异步。官方说明同步方法加密的数据能用 `decryptStringAsync` 解开，已保存的凭据不用迁移格式。`getSelectedStorageBackend()`（`config.ts:122`）没有弃用。

本项目没用到的模块：`protocol`、`autoUpdater`（更新检查是自己实现的 `src/modules/updater`，只用 `shell.openExternal`）、`clipboard`、`desktopCapturer`、`contentTracing`、offscreen。`webRequest`（`src/main/handlers/core/interceptor.ts:153-161`）、`shell.openExternal`（`src/main/handlers/plugins/externalLink.ts:25`、`src/modules/updater/updateChecker.ts:297-341`）、`Tray`、`dialog`、`ipcMain`、`contextBridge` 在 39 到 45 之间都没有 breaking change。

### 工具链和系统版本

- electron-builder 26.18.0：三平台打包成功，`@electron/rebuild electronVersion=45.2.3`，没有要编译的原生依赖；它自己用 `app-builder-lib` 里的 `@electron/get` 下载 Electron zip，不依赖 `electron` 包的 `postinstall`。`peerDependencies` 没有限定 Electron 版本。
- Node：Electron 45.2.3 内置 Node 24.22.2，38.8.6 是 22.22.0。`electron@45.2.3` 依赖 `@types/node ^24.9.0`，lockfile 里装了 `@types/node@24.19.2`（嵌套在 `node_modules/electron` 下），但 `tsconfig.json` 的 `typeRoots` 让 `tsc` 只加载根目录的 `@types/node@20.19.43`（`--listFiles` 核实）。类型比运行时落后两个大版本：不会编译出错，只是用不上 Node 22、24 新增 API 的类型，也看不到 Node 24 里被删 API 的类型报错。主进程没用 Node 24 删掉或运行时弃用的 API（`util.is*`、`url.parse`、`new Buffer`、`spawn` 带 `shell` 传参都没有）；`node-mpv-2` 用 `execSync` 字符串和不带 `shell` 的 `spawn`，Node 24 下行为不变。建议另行把 `@types/node` 升到 24。`electron` 45 要求 `node >= 22.12.0`，CI 是 22.23.4，本机 26.13.0，都满足。
- `sharp` 0.35.5：只在 `devDependencies`，只被 `scripts/generate-iconset.js` 用来生成图标，不打进安装包，和 Electron ABI 无关。项目运行时依赖（`axios`、`node-cache`、`node-mpv-2`、`semver`）都是纯 JS。
- 系统版本：
  - macOS：38 要求 12（Monterey）及以上，44 起要求 13（Ventura）及以上。macOS 12 用户装 45 构建的版本会打不开，要在发版说明里写明，留在 12 的用户只能用旧版本。
  - Windows：仍是 Windows 10 及以上，没有变化。本项目不出 ia32 包。
  - Linux：Electron 45 的 README 不再列具体发行版，改成“Chromium 和发行版都还在支持的版本”；38 的 README 写的是 Ubuntu 18.04、Fedora 32、Debian 10 及以上。很老的发行版可能跑不起来，CI 只验证了 GitHub runner 上的 Ubuntu。

### 冒烟测试覆盖不到的风险和手测清单

冒烟测试只到登录页、Proxy 健康检查和退出，不登录、不播放。下面要维护者用 #134 重建后的安装包手测，至少 Windows 一台，macOS、Linux 能测就测：

1. 登录：账号密码登录 NAS，勾选记住后重启客户端仍保持登录（`safeStorage` 加解密，`config.ts:119-132`）；Linux 上没有密钥环时仍拒绝明文保存。用 38 版本保存过凭据的配置升级后能直接解开。
2. FN ID 登录：OAuth 窗口打开、扫码或账号登录后回到主窗口（`fnIdOauthWindow.ts`，cookie `changed` 事件）；访问码验证（`accessCodeSession.ts` 的 `net.request`）。
3. 自签名证书的 NAS：出现信任确认对话框，信任后正常加载（`main.ts:45`）。
4. MPV 播放：点播放按钮启动附带的 MPV（Windows）或系统 MPV（macOS、Linux），起播、拖进度、弹幕插件加载、关闭 MPV 后回到客户端。启动日志里 MPV 配置同步结果正常（`synchronizeMpvConfig`）。
5. 托盘“设置MPV播放器路径”：对话框能选文件，选完生效；确认对话框现在从“下载”目录开始（43 的变化），记下是否要改。
6. Proxy：登录后浏览、播放时走本地 Proxy 正常（302 跳转、断点续传）；退出客户端后 `127.0.0.1:22345` 不再监听。
7. 窗口：Windows、Linux 无边框窗口的自定义标题栏按钮（最小化、最大化、关闭）可用，Linux 上看圆角是否和标题栏冲突；macOS 交通灯位置正常。关闭主窗口隐藏到托盘或状态栏，从托盘恢复，托盘菜单退出能真正退出。
8. macOS 通知：第一次关闭主窗口时“应用已隐藏到状态栏”的通知是否出现（未签名应用在 42 起可能不显示）；Windows 托盘气泡提示是否出现。
9. 外部链接和更新检查：页面里的外部链接用系统浏览器打开（`externalLink.ts`）；“检查更新”能取到版本信息、点下载打开浏览器（`updateChecker.ts`）。
10. 网页端自带播放器（关掉 MPV 接管时）：视频能播放、全屏正常（Chromium 版本跨度 140 → 156，WebGL 和硬件解码路径有变化）。
11. macOS 12 机器（如果有）：确认 45 构建打不开，作为发版说明的依据。
