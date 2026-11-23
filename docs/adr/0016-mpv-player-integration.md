---
status: accepted
---

# MPV 播放器集成事实

`src/modules/players/impl/mpv.ts` 通过 `node-mpv-2` 驱动 MPV 播放。IPC 地址命名与清理时机见 [ADR-0011](0011-platform-behavior-facts.md)。

## 播放列表与 `path` 事件

- MPV 的 `path` 属性会原样报回 M3U8 播放列表里的地址，因此按 `item.playLink === mpvPath` 反查当前播放项。
- 加载播放列表时，MPV 最先报出的 `path` 是 `.m3u8` 播放列表文件本身，在播放列表项里找不到，直接忽略。
- 跳转到播放列表指定位置时直接 `await setProperty('playlist-pos', pos)`，不调用 `node-mpv-2` 的 `jump(pos)`。`node-mpv-2` 的 `jump()` 会另开一条 `observeSocket`，先 `await setProperty('playlist-pos', pos)` 之后才注册 `data` 监听等待 `start-file` 与 `playback-restart`，容易错过事件；且它没有时间超时和连接关闭处理，也没有捕获连接回调里的异常，会导致 Promise 永久挂起或产生未处理拒绝。`MpvPlayer` 已通过 `status` 事件监听 `playlist-pos` 与 `path`，只需等待 MPV 确认属性设置即可。

## 字幕名称

- 下载到本地的字幕文件名带有 `<原始字幕名>@...` 后缀，交给 MPV `addSubtitles` 前按 `@` 截断取前半段作为显示名称。

## 播放事件与进度回传

- `ITEM_END` 只表示一个播放项结束了播放（播放器切到下一项），不含“看完了”的判断；够不够格标记已观看由播放模块判定。
- MPV 异常退出时不写最终播放进度，不能取代排队的进度回传。

## `node-mpv-2` 的连接（`tests/mpvIpc.test.cjs`）

- `start()` 连上已有的 MPV 时直接接管，不启动子进程，测试借这条路径用假的 JSON IPC 服务端驱动库的公开接口。`start()` 的探测连接一直不关，最后一个连接才是库的主连接。收到 `seek` 事件后库另开一个连接等 `playback-restart`。
