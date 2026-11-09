# MPV IPC（node-mpv-2）

相关：[依赖更新（Renovate）](dependency-updates.md)、[多平台测试策略](multi-platform-testing.md)、[外部运行时归属](../external-runtime.md)。

## 2026-11-09 调查和加固

起因：依赖审计（`node-mpv-2` 一节）读源码发现两个隐患，当时没有复现。`node-mpv-2` 2.0.0-beta.3 是 2023-04-23 发布的，上游 husudosu/Node-MPV 之后没有发版，项目里只有 `src/modules/players/impl/mpv.ts` 用它。维护者当天同意先加固、不重写。修复提交 `6923dde`（分支 `fix/mpv-ipc-hardening`）。

### 隐患 (a)：固定的 IPC 地址

- 默认地址写死在 `node_modules/node-mpv-2/lib/util.js:136`：Windows 是 `\\.\pipe\mpvserver`，其它平台是 `/tmp/node-mpv.sock`。`mpv.ts` 构造时没传 `socket`，用的就是它。
- `lib/mpv/_startStop.js:37-65`：`start()` 先连这个地址，发 `get_property mpv-version`，回复 `error: success` 就认定是 MPV，走 `:160-166` 直接接管，不启动子进程。这时 `mpvPlayer` 不存在，`close`、`quit` 事件也换成 `:213-221` 那一套。
- 后果：用户自己开着带 `--input-ipc-server=\\.\pipe\mpvserver` 的 MPV，或者客户端里上一个 MPV 还没退出，播放请求会发到那个 MPV。Windows 上两个 MPV 也不能绑定同一个命名管道，后启动的会绑定失败（库等的是 `Could not bind IPC (socket|pipe)`，`_startStop.js:99`；这一条没有实测）。
- 本地确认（Windows，安装版自带的 `mpv.exe`，`mpv v0.42.0-5-g55d3feb45`）：在 `\\.\pipe\mpvserver` 开一个假的 IPC 服务端，`new NodeMpv({ binary }).start()` 连上假服务端，没有启动 `mpv.exe`；改用唯一地址后正常启动真实 MPV，假服务端没有收到连接。

### 隐患 (b)：消息不按行缓冲

- `lib/ipcInterface/_events.js:48-81` 的 `dataHandler`（`lib/ipcInterface/ipcInterface.js:160` 绑到主连接的 `data`）把每个 chunk 按 `\n` 切开后直接 `JSON.parse`（`:56`、`:77`），不保留末尾的半行。一条消息分两次到达时在 socket 的 `data` 回调里抛 `SyntaxError`，主进程里就是未捕获异常。`data.toString()` 逐块解码，UTF-8 字符被切开时也会变成乱码。
- 同样写法还有 9 处临时连接：`lib/mpv/_events.js:154-159`（`seek` 事件后等 `playback-restart`）、`lib/mpv/_playlist.js:67-72`（`loadPlaylist`）、`:177-182`（`next`）、`:264-269`（`prev`）、`:333-338`（`jump`）、`lib/mpv/_controls.js:37-42`（`play`）、`:124-129`（`seek`）、`lib/mpv/mpv.js:146-151`（`load`）、`lib/mpv/_startStop.js:129-134`（启动时等 idle）。`_startStop.js:49` 探测 `mpv-version` 时也整块 `JSON.parse`，但在 `try` 里，失败只会当作没有 MPV。
- 复现：`tests/mpvIpc.test.cjs` 用本地 `net` 服务端假扮 MPV（借上面 (a) 的接管路径，不用启动 MPV），把一条消息按字节拆成两段、间隔 50ms 发送。打补丁前 4 个用例都失败，报 `SyntaxError: Unterminated string in JSON`，栈在 `ipcInterface/_events.js:56` 和 `mpv/_events.js:159`；打补丁后通过。

### 修复

- (a)：`src/public/platform.ts` 的 `mpvIpcSocket(platform, tmpDir, id)` 按平台给地址：Windows 是 `\\.\pipe\fntv-mpv-<id>`，不落盘；其它平台是 `<tmpDir>/fntv-mpv-<id>.sock`，超过 Unix socket 路径上限（取 103 字节，macOS 的 `sun_path` 是 104）时改放 `/tmp`。`src/modules/players/impl/mpvIpcSocket.ts` 用进程号加 4 字节随机串作 `id`，每次播放一个；`mpv.ts` 在 `quit` 事件（MPV 已退出）和 `stop()` 里 `quit()` 返回后删 socket 文件。不能更早删：MPV 还在运行时，库处理 `seek` 事件会按路径另开连接，文件不在会连接失败，而那个临时 socket 没有 `error` 监听。
- (b)：库外面包不住：主连接的 `dataHandler` 能在实例上覆盖，但 9 处临时连接的回调是闭包。改用 `pnpm patch`（`patches/node-mpv-2@2.0.0-beta.3.patch`，登记在 `pnpm-workspace.yaml` 的 `patchedDependencies`），补丁只做按行缓冲：`lib/util.js` 加 `lineSplitter()`（`StringDecoder` 加末尾半行缓存），上面 10 处 `data.toString(...).split('\n')` 换成它，主连接在每次 `connect()` 时重建，崩溃重启后不带上一个连接的半行。其它逻辑不动，`package.json` 没有改。

### 升级和 Renovate 的影响

- 补丁按 `node-mpv-2@2.0.0-beta.3` 绑定。版本号变了而补丁没跟着改时，`pnpm install` 直接失败：`The following patches were not used: node-mpv-2@...`（2026-11-09 本地把键改成 `2.0.0-beta.2` 实测）。Renovate 万一开了 `node-mpv-2` 的更新 PR，会在更新锁文件这一步失败，不会悄悄丢掉补丁。
- 换版本时：先看新版本是否已经按行缓冲，修了就删掉补丁和 `patchedDependencies` 里那一项；没修就在新版本上 `pnpm patch` 重做。`tests/mpvIpc.test.cjs` 是验收。
- 上游已停更，实际上不太会有新版本。

### 没有做的

- 没有加全局 `uncaughtException` 兜底，审计里说另外讨论。
- MPV 以 0 和 4 以外的退出码结束时，库不发任何事件（`lib/mpv/_events.js:78-81`），`mpv.ts` 不知道播放结束，socket 文件留在临时目录。退出码 4 时库按 `auto_restart` 用同一地址重启 MPV 后才发 `crashed`，文件还在用，也不删。
- 维护者只有 Windows，macOS、Linux 上 socket 文件的创建和删除只有单元测试和 CI，没有真实播放验证。

### 待维护者手测

起播；拖进度（进度条拖动后续播位置正确、进度上报正常）；从剧集列表跳到中间一集起播、MPV 里切下一集；外挂字幕加载；关闭 MPV 窗口后回到客户端、再次播放；先自己开一个 `mpv --idle --input-ipc-server=\\.\pipe\mpvserver`，再从客户端播放，确认客户端新开了自己的 MPV，自己那个不受影响。
