---
status: accepted
---

# 更新检查与弹窗生命周期

`src/modules/updater/updateChecker.ts` 负责版本检查、下载链接改写以及更新弹窗时机。应用内更新的平台可用性与元数据校验见 [ADR-0003](0003-release-gate.md) 和 [ADR-0011](0011-platform-behavior-facts.md)。

## 检查源、重试与回退

- 优先请求 GitHub Releases API；当仓库尚未发布任何 Release 时 GitHub 返回 404，视为“暂无更新”而非检查失败。
- API 请求使用指数退避重试，但只重试网络错误和 5xx，4xx 原样抛出：4xx 在几秒内不会恢复，重试只会白白消耗 GitHub API 额度。
- 触发限流时将恢复时间 `rateLimitedUntil` 记在内存中，恢复前不再请求 API。API 失败或处于限流期时，回退到请求 GitHub Release 页面的重定向拿最新 tag（`fetchLatestTagFromReleasePage`），再按构建命名规则（`expectedAssetName`）拼出安装包链接。
- 未认证的 GitHub API 每个出口 IP 每小时 60 次，NAT、代理和 VPN 后面的请求共用额度。未认证时带 `If-None-Match` 得到 304 也会扣额度（2026-11-07 实测），所以不做条件请求。限流响应拿不到恢复时间时按一小时窗口估算。`releases/latest` 页面不走 API 限流：请求时不跟随重定向，从 `Location` 取 tag。
- 更新提示框是原生对话框，只能显示纯文本，也不能滚动，正文过长会把按钮挤出屏幕，所以 Release 正文转成纯文本并限制行数和字数。release-please 的版本标题是 `## [2.7.0](compare 链接) (日期)`，首个版本没有 compare 链接；条目开头的 `**scope:** `、条目末尾的 `([abc1234](commit 链接))`、`([#12](issue 链接))`，以及提交正文 `Closes #12` 生成的 `, closes [#12](链接)` 都去掉。

## 下载加速中转

- 开启应用更新下载加速时，对包含 `github.com` 的地址加上中转前缀（去掉前缀末尾斜杠后拼接原地址）。手动下载的安装包链接和应用内更新的 `electron-updater` 更新源都按同一规则改写。

## 弹窗与播放、退出生命周期

- 自动检查更新失败时只记日志、不弹错误框，避免打扰用户；手动检查更新则向用户展示所有结果和错误。
- 自动检查发现新版本时，若 MPV 正在播放则推迟弹窗，等播放结束后再弹一次。新的推迟提示会替换旧的；客户端退出或用户主动手动检查已弹框时作废推迟提示。
- 退出流程里停止播放也会触发 `onPlaybackEnded`，因此必须在 `onQuitStarted`（停止播放之前）取消推迟的更新提示。
- 用户主动手动检查时，即使正在播放也立即弹框，并取消此前推迟的提示。
- 用户选择“下载并安装”后在后台启动 `inAppUpdate.downloadAndInstall()`，不阻塞对话框调用返回；下载失败时的错误提示由 `InAppUpdate` 自行弹出。
- 启动 3 秒后才自动检查更新，不拖慢启动。

## 应用内更新（`src/modules/updater/inAppUpdate.ts`）

用户在更新检查的弹框里点「下载并安装」后，由 `electron-updater` 下载、校验 sha512 并安装。要不要更新只由更新检查判断；这里调 `autoUpdater.checkForUpdates()` 只是为了读更新源上的 `latest.yml`，`downloadUpdate()` 要先有这份元数据。任何一步失败都退回手动更新：弹框提供「打开下载页面」，打开 Release 页面。

- 更新源地址每次开始下载时才读取，下载加速开关改了随时生效。
- `downloadAndInstall()` 的 Promise 要等下载结束、用户选完安装方式才完成，调用方不必等它，错误都在里面处理成弹框；下载中再次调用不会开始第二次下载。下载进度（0 到 100 的整数，下载结束时为 `null`）供托盘的「检查更新」项和主窗口的任务栏进度条显示。
- 差量下载开着，只下有变化的块；中转不支持 `Range` 等原因让差量失败时，`electron-updater` 自动改下完整安装包。
- 下载完成那一刻 `electron-updater` 只在 `autoInstallOnAppQuit` 为 `true` 时注册退出时安装的处理，所以下载期间先打开，下载完成后立刻关掉，用户选了「退出时安装」再打开。
- 下载完成后问安装方式：「立即重启安装」「退出时安装」「稍后提醒」。关掉对话框等于「稍后提醒」，什么都不装，下次检查再问：安装要用户点头。
- 「立即重启安装」先停 MPV 并等这次退出的进度回传：Windows 上附带的 MPV 在安装目录里，`mpv.exe` 运行时安装程序覆盖不了它。回传失败只记日志、不阻止安装；回传或 MPV 退出迟迟不来时，`stopPlaybackAndWait` 等到超时就返回，照常安装。安装前关掉 `autoInstallOnAppQuit`（之前选过「退出时安装」时它还开着）：这次安装失败的话，`electron-updater` 会在退出时自己再装，那条路径不先停 MPV。之后静默安装（不显示向导，沿用原安装目录），装完重新打开客户端。安装程序启动失败时 `electron-updater` 同步发 `error` 事件，阶段回到已下载，客户端不退出。
- 「退出时安装」由退出协调执行：它先停 MPV、等进度回传、关 Proxy，再由 `quitAndInstall` 静默安装并重新发起退出，装完不重新打开客户端（用户要的是退出）。`electron-updater` 自己的退出时安装挂在 `quit` 事件上，那时 MPV 可能还开着，所以抢在它前面装；`quitAndInstall` 之后 `electron-updater` 看到安装已经开始，不会在 `quit` 时再装一次。安装失败时弹框提示，然后照常退出。
- 系统关机、重启或注销时放弃「退出时安装」（维护者决定不在关机时尽力安装，#192），回到「已下载、未选安装方式」，下次点「下载并安装」时 `electron-updater` 复用已下载的安装包。安装已经开始或没选「退出时安装」时不受影响。
- 下载阶段的错误会让 `downloadUpdate()` 失败，在那里处理；安装阶段（`quitAndInstall` 启动安装程序失败）只有 `error` 事件，所以总要监听它，没有监听时 `EventEmitter` 会把 error 抛出去。
- Linux：`electron-updater` 安装时先删掉旧 AppImage。旧文件名里有 x.y.z 三段数字时，新文件用新版本的文件名，指向旧文件名的快捷方式会失效，并发 `appimage-filename-updated` 事件（只记日志，用户该怎么做见 README 的 Linux 安装说明）；没有时沿用原文件名，不发。

## 退出协调（`src/modules/quit/quitCoordinator.ts`）

用户发起的退出（托盘菜单、菜单栏、`app.quit()`）先被拦下，按顺序收尾：停止播放并等这次退出的进度回传（`stopPlaybackAndWait` 自带超时）；关闭 Proxy 并等它关完；用户选了「退出时安装」就交给应用内更新（它发起退出），否则重新发起退出。

- 收尾之后的退出直接放行，这时才调用 `onQuitReleased`（销毁托盘），收尾期间托盘图标还在。收尾期间再请求退出照样拦下，不重复收尾。
- 每一步失败都记日志后继续，客户端不会卡在退不出去。
- 「立即重启安装」引发的退出（`quitForInstall`）直接放行：拦下会让安装作废。它照常关 Proxy、销毁托盘，但不等 Proxy 关完；它和收尾共用同一次关闭。安装程序没启动时恢复原状，之后的退出按普通退出处理。收尾期间「立即重启安装」接手了退出时，收尾不再往下走。
- 系统关机、重启或注销：Windows 是主窗口的 `session-end`（`WM_ENDSESSION`），这种退出不发 `before-quit`，收尾和安装都不会运行；Linux 是 `powerMonitor` 的 `shutdown`，随后 SIGTERM 按普通退出收尾（注销只有 SIGTERM，分不出来，照常安装）。macOS 关机时也发 `shutdown`，但 macOS 没有应用内更新，收到后什么都不做。收到后放弃这次「退出时安装」，不调用 `preventDefault`，不推迟关机。监听在主窗口创建后注册，要在 app ready 之后：那之前不能用 `powerMonitor`。
- `stopPlaybackAndWait` 从调用起最多等 5 秒，覆盖停止 MPV 和进度回传：回传请求单个最长约 1 分钟，最多三个，安装和退出等不了这么久。超时后记 warn 并照常返回，不改播放状态，回传在后台继续，完成后照常通知 `onPlaybackEnded`。正在启动播放时调用会取消启动。

## 测试替身（`tests/helpers/updateChecker.cjs`）

- 假的 `autoUpdater` 照 `electron-updater` 的行为：下载出错时先发 `error` 事件再 reject；`quitAndInstall` 启动安装程序成功就在下一轮 `app.quit()`，启动前就失败时同步发 `error` 事件、不退出（`BaseUpdater`）。假的 `app.quit()` 像 Electron 那样发 `before-quit`（`tests/helpers/fakeQuitApp.cjs`）。
- 断言某事会发生时用 `waitFor` 等条件成立。断言某事“没有发生”时没有可等的条件，`settle()` 让已排队的回调跑 20 轮，远多于更新流程里最长的 await 链（约 6 层）。
