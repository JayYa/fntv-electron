---
status: accepted
---

# Proxy 改用 TypeScript，运行在 utilityProcess

Proxy 原来是单独打包的 Go 可执行文件，构建要装 Go 工具链、为 6 个目标交叉编译，飞牛影视服务的 API 客户端在 Go 和 TS 各写一份，播放会话字段、访问授权 Cookie 拼接这些约定也要两边同步。取流瓶颈在网络而不在 CPU，换成 Node 不影响播放。所以 Proxy 改用 TypeScript，由客户端用 `utilityProcess.fork()` 启动，和主进程共用 `fn_api` 里不依赖 Electron 的那一层。

客户端和 Proxy 之间的控制（创建播放会话、确认就绪）走 `parentPort` IPC，HTTP 只保留 MPV 取流用的 `/api/v1/playvideo` 和 `/api/v1/skipinfo`。Proxy 随客户端退出，不会再变成孤儿进程，所以 Proxy 密钥、`proxy-secret` 文件、`/health` 和孤儿复用都删掉。这一条取代 ADR-0001 的“Proxy 密钥持久化”。

端口仍固定为 `127.0.0.1:22345`，因为 MPV 归档里的 `smart_skip` 插件把这个地址写死了。

## Considered Options

- **保留 Go**：放弃。只为一个约 2000 行的转发服务，就要多一套工具链、交叉编译和两份 API 客户端。
- **在主进程里跑 Proxy**：放弃。视频流量会和窗口、IPC 抢同一个事件循环。
- **单独打包 Node 运行时，spawn 成子进程**：放弃。这又多出一个要分发的运行时。
- **保留 HTTP 控制接口和密钥，只翻译代码**：放弃。密钥和孤儿复用只是为了应对 Proxy 比客户端活得久，`utilityProcess` 不会出现这种情况。
- **随机端口**：暂缓。要先改 `fntv-mpv-config` 里的 `smart_skip`，让它从播放地址中解析主机和端口，另开 issue 跟进。
- **新旧 Proxy 用开关并存**：放弃。直接替换，靠发版门禁（ADR-0003）和契约测试兜底。

## Consequences

- 网盘取流的特殊行为（115 的 UA 和限流、夸克分片对齐、Range 请求重试、Cookie 处理）在 Go 测试删除前，要先有对应的 `node --test` 测试。

## 更新：随机端口已实施（#167）

`fntv-mpv-config` 的 `smart_skip` 改为从播放地址取 scheme、主机和端口（归档 `fntv-mpv-v20261110_224319` 起）。客户端随后让 Proxy 监听端口 0，由系统分配，实际端口随就绪消息报给主进程，播放地址用这个端口拼。上文“端口仍固定为 `127.0.0.1:22345`”和“随机端口：暂缓”是当时的决定，现已被这一条取代。

- 端口占用的报错、弹窗和对应的冒烟测试都删掉了。残留的旧版 Go Proxy 占着 22345 也不影响新版本启动。
- 客户端固定了归档的 tag 和 sha256，不会出现旧归档配新客户端。新归档配旧客户端也能用，因为旧客户端的播放地址仍是 22345。
