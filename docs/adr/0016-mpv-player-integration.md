---
status: accepted
---

# MPV 播放器集成事实

`src/modules/players/impl/mpv.ts` 通过 `node-mpv-2` 驱动 MPV 播放。IPC 地址命名与清理时机见 [ADR-0011](0011-platform-behavior-facts.md)。

## 播放列表与 `path` 事件

- MPV 的 `path` 属性会原样报回 M3U8 播放列表里的地址，因此按 `item.playLink === mpvPath` 反查当前播放项。
- 加载播放列表时，MPV 最先报出的 `path` 是 `.m3u8` 播放列表文件本身，在播放列表项里找不到，直接忽略。
- 跳转到播放列表指定位置时直接 `await setProperty('playlist-pos', pos)`，不调用 `node-mpv-2` 的 `jump(pos)`。`node-mpv-2` 的 `jump()` 会另开一条 `observeSocket`，先 `await setProperty('playlist-pos', pos)` 之后才注册 `data` 监听等待 `start-file` 与 `playback-restart`，容易错过事件；且它没有时间超时和连接关闭处理，也没有捕获连接回调里的异常，会导致 Promise 永久挂起或产生未处理拒绝。`MpvPlayer` 已通过属性变化监听 `playlist-pos` 与 `path`，只需等待 MPV 确认属性设置即可。

## 字幕名称

- 下载到本地的字幕文件名带有 `<原始字幕名>@...` 后缀，交给 MPV `addSubtitles` 前按 `@` 截断取前半段作为显示名称。

## 播放事件与进度回传

- `ITEM_END` 只表示一个播放项结束了播放（播放器切到下一项），不含“看完了”的判断；够不够格标记已观看由播放模块判定。
- MPV 异常退出时不写最终播放进度，不能取代排队的进度回传。
- 接近片尾是播放进度达到总时长的 98%（`src/modules/playback/nearEnd.ts`）。总时长不大于 0 时一律不算接近片尾：直链类播放源拿不到可靠时长，宁可漏判也不误判；这时打开播放项也不续播。
- 一次播放的写入（`src/modules/playback/writeQueue.ts`）按到达顺序逐条写，前一条完成或失败才开始下一条，播放进度不会被较早发出、较晚完成的请求倒退回去。只有排队还没开始的进度回传会被取代：新的进度回传取代旧的；`final`（离开播放项时写最终进度和已观看）取代同一播放项排队的进度回传；`other`（不写进度的操作，例如 MPV 异常退出后刷新网页端）只排在前面的写入之后，不取代任何写入。返回的 Promise 在这条写完或被取代时兑现，不 reject。

## MPV 进程

`src/modules/players/impl/mpvProcess.ts` 是 MPV 进程的适配器，`node-mpv-2`、它的 patch 和库的私有字段只在这里用到；`MpvPlayer` 只通过它的接口拿属性变化、时间位置、跳转和退出，测试用 `tests/helpers/fakeMpvProcess.cjs` 代替它。适配器保证：

- `start()` 要么成功，要么 reject 且不留下 MPV 进程；reject 时不报退出。启动期间被 `stop()` 也按 reject 处理，`playList` 返回 false，不发 ERROR 也不发 EXIT，一次播放由 `runPlayback` 收尾；`start()` 成功后、播放列表加载完之前被 `stop()` 时 `playList` 返回 true，一次播放等 MPV 退出后的 EXIT 收尾，最终播放进度照常写回。
- `start()` 成功后退出恰好报一次，报出时 MPV 已经退出、Unix socket 文件已经删掉，之后不再有任何事件；`stop()` 之后只会再报退出，命令一律 reject。
- 退出只看库私有的子进程字段 `mpvPlayer` 的 `exit`，不看库的 `quit`/`crashed`。客户端自己 `stop()` 的退出码记 0（正常退出，写最终播放进度），被信号终止或退出码未知记 1，其余用 MPV 的真实退出码，例如崩溃是 4。`stop()` 不当场报退出，MPV 一直不退出时由一次播放的停止超时兜底。`tests/mpvProcess.test.cjs` 用真实的库加替换的 `child_process` 钉住这个私有字段，升级库后字段改名会失败。

`node-mpv-2` 本身的行为，适配器据此补齐：

- `auto_restart` 默认开启：MPV 崩溃（退出码 4）后库先在后台重启一个 MPV，再发 `crashed`，重启出来的 MPV 不属于任何一次播放。构造时传 `auto_restart: false`。
- 退出码不是 0 或 4（包括被信号终止）时库什么事件都不发。
- `quit()` 和库自己的 `close` 处理都会摘掉子进程的全部 `close`、`error` 监听，所以适配器监听的是 `exit`，kill 前重新挂上 `error` 监听，`kill()` 发不出信号时不成为未捕获异常。
- 库的 `start()` 原本只等 stdout 的 `Listening to IPC socket` 和 observe socket 的 idle，子进程在这之前退出时永远不兑现；子进程的 `error` 和两条连接的 `error` 也没人监听，会成为未捕获异常。`patches/` 里给 `start()` 补上：从 spawn 到启动完成期间，子进程 `exit`、子进程 `error`、连接 `error` 都让 `start()` reject，并断开连接、摘掉 stdout 监听。
- 库在 `start()` 完成后给子进程挂的 `error` 监听调用 `this.errorHandler(error)`，但构造函数里的 `this.errorHandler = new ErrorHandler()` 遮住了同名的方法，监听会抛出 `TypeError`，播放中子进程的 `error` 因此成为未捕获异常。`patches/` 把这个监听改成只在 `debug` 时打印。子进程的 `error` 不结束播放。
- `start()` 没有完成时库的主连接没连上，`quit()` 发不出 `quit` 命令（向没连上的 socket 写入还会抛出未捕获的 `ERR_SOCKET_CLOSED`），所以这时停止直接 kill 子进程；还没 spawn 时等 `start()` 结束再 kill。`start()` 完成后 `quit()` 失败也退而 kill。`kill()` 失败时当场删 Unix socket 文件。
- `start()` 连上已有的 MPV 时没有子进程，适配器报不出退出；每次播放的 IPC 地址都是新的（ADR-0011），正常使用不会接管。

## `node-mpv-2` 的连接（`tests/mpvIpc.test.cjs`）

- `start()` 连上已有的 MPV 时直接接管，不启动子进程，测试借这条路径用假的 JSON IPC 服务端驱动库的公开接口。`start()` 的探测连接一直不关，最后一个连接才是库的主连接。收到 `seek` 事件后库另开一个连接等 `playback-restart`。
