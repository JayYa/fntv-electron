---
status: accepted
---

# Proxy 改用 TypeScript，运行在 utilityProcess

Proxy 原来是单独打包的 Go 可执行文件，构建要装 Go 工具链、为 6 个目标交叉编译，飞牛影视服务的 API 客户端在 Go 和 TS 各写一份，播放会话字段、访问授权 Cookie 拼接这些约定也要两边同步。取流瓶颈在网络而不在 CPU，换成 Node 不影响播放。所以 Proxy 改用 TypeScript，由客户端用 `utilityProcess.fork()` 启动，和主进程共用 `fn_api` 里不依赖 Electron 的那一层。

客户端和 Proxy 之间的控制（创建播放会话、确认就绪）走 `parentPort` IPC，HTTP 只保留 MPV 取流用的 `/api/v1/playvideo` 和 `/api/v1/skipinfo`。Proxy 随客户端退出，不会再变成孤儿进程，所以 Proxy 密钥、`proxy-secret` 文件、`/health` 和孤儿复用都删掉。这一条取代 ADR-0001 的“Proxy 密钥持久化”。

从 Go 版升级的用户目录里留着 `proxy-secret`，启动时删掉（`src/main/common/legacyProxySecret.ts`）；删不掉（例如 Windows 上文件被占用，`EPERM`、`EBUSY`）只记日志，TS 版用不到这个文件，不影响启动，下次启动再删。

子进程（`child.ts`）只转发 `parentPort` 的消息、回报启动结果和日志。监听失败时它报 `startFailed`（带错误码），由主进程结束这个进程。播放会话只在创建它的那个 Proxy 子进程里有效，所以主进程拿到的会话 ID 和该进程的端口一起返回（`ProxyPlaybackSession`，`src/main/common/proxySession.ts`）。

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

## 取流行为与 Go 版的异同

移植时按 wiki 里的 Go 行为清单逐条决定照搬还是改，编号（`U-xx`、`G-xxx`）出自那份清单。下面没写“改了”的都和 Go 版一致。

- HTTP 服务：路径去掉末尾的 `/` 能匹配路由时重定向，GET 用 301、其它方法用 307（gin 的 `RedirectTrailingSlash`）。`requestTimeout`、`headersTimeout`、`timeout` 都是 0：长时间的视频流不能被服务端切断。
- 缓存：NAS 调用的缓存所有会话共用，同一台 NAS、同一个 token 命中同一份，只缓存成功结果（ADR-0012）。夸克元信息缓存 200 分钟，键是流信息给的原始直链（整串，含 userinfo 和 query），只缓存成功结果；转发目标的 URL 已去掉 userinfo，不能当键。
- 115 限流：全局令牌桶，不分会话、不分文件，第一个请求不等，并发请求依次排队（U-08），正式运行的间隔是 1 秒（`child.ts`）。每个 MPV 请求只等一次，416 后不带 Range 的重试不再等（G-163-03）。等待中的 MPV 断开后，占下的放行时刻不归还，后面的请求照样排在它之后；等完时请求已取消，不再发给网盘（U-19、G-163-04）。只有 115 直连限流，其他网盘、夸克和 NAS 中转的 115 都不限流（G-163-05）。`tests/proxyService115.test.cjs` 检查间隔时比的是第 k 个请求到达网盘不早于开始时刻加 k 个间隔，不比相邻两次到达的差：到达比放行晚一次本机连接，差值有几十毫秒的抖动。
- 夸克直连（Go 的 `ChunkedProxy`）：先取文件元信息，再从 MPV 请求的起点向直链取，同一请求内按顺序取，不按分片对齐，没有并发上限和预取。只发白名单头加直链的 UA、Cookie 和认证，没有 `X-Forwarded-For`。Range 同 Go 的 `parseRange`：没有 Range 按 `0-` 处理，只认 `bytes=<start>-[<end>]`；不合法或起点超出文件时返回 416（先取了元信息才知道总大小）；终点小于起点时不理会终点。上游返回 200、206 以外的状态码时原样返回状态码、`Content-Type` 和 body，不重试。改了的：
  - 返回 MPV 请求的区间，单次最多 10MiB（U-01）。
  - 网盘忽略 Range、从第 0 字节返回 200 时，跳过起点之前的字节，按 206 返回（U-03）。上游提前结束时断开到 MPV 的连接，让它知道没拿够。
  - 206 响应去掉逐跳头和 `Set-Cookie`（U-14）。
  - 用空闲超时代替 Go 的 60 秒总超时（U-06）：收响应头和 body 期间都算，低速但持续有数据时不断开，默认 60 秒。
- 115 限流的定时器可能比 `Date.now()` 早 1 毫秒触发，没到放行时刻就再等一轮。
- 透明转发（`forward.ts`）：只转发白名单里的 MPV 请求头，MPV 的 Cookie、Authorization 不转发，改了（U-05）；转发目标给的头覆盖白名单头，NAS 的 Authorization 和访问授权 Cookie 就这样带上。逐跳头和 `Connection` 里列出的头不转发。上游以 416 拒绝初始的开放 Range（`bytes=0-`）时去掉 Range 重试一次。出错时响应的 `details` 只给错误码，不含上游 URL，改了（U-10）：Go 的 `details` 是错误串，带完整直链和签名。直链的已编码路径和 query 原样转发，改了（U-15）：Go 把解码后的 path 重新编码，`%2F` 会变成 `/`，签名直链要原样。日志只记方法、路径和 Range，不记主机：NAS 路径下就是完整 NAS 地址（`CODING_STANDARDS.md`）。
- 直链媒体（`directLink.ts`）：`cloud_storage_info` 非空且有直链时才算直链媒体，否则按 NAS 本地播放源处理；直链固定取第一个，不随 `sourceIndex` 或清晰度变化。`CLOUD_TYPE_115`、`CLOUD_TYPE_QUARK` 特殊处理，其余网盘透明转发。直连时 Cookie 用 `; ` 连接流信息里的全部 Cookie，不去重、不加 `mode=relay`，不带 NAS 的 Authorization 和访问授权 Cookie；UA 取流信息里第一个 trim 后非空的，对所有直连网盘生效，覆盖 MPV 的 UA（U-09）。直连总是校验证书，会话的 `skipVerify` 只对 NAS 生效。WebDAV 这类直链把账号写在 URL 里：改成 Basic 认证并从 URL 里去掉；MPV 的 Authorization 不转发，所以有账号时总是补上。解析不了的 URL 原样交给转发报错。NAS 中转的直链媒体走 NAS，只带 token 和访问授权。
- `/api/v1/playvideo`：`sourceIndex` 同 Go 的 `strconv.ParseInt(s, 10, 32)`，缺省或空串按 0，越界或为负时退回第 0 个。流信息请求里的 `ip` 是 `sha1(account)` 的前 16 字节按 UUID 格式写出（Go 的 `StringToUUID`），账号为空时是全 0 的 UUID。
- `/api/v1/skipinfo`：成功返回 `{code:0,msg:"success"}`，失败 `{code:1000,msg}`。GET 不走缓存，每次取 NAS 上的最新值。POST 先解析 body 再看 query，顺序同 Go；body 按 Go 的 `encoding/json` 解到 `{guid, skipStart, skipEnd}`：键名不分大小写，`null` 当作没写，多余字段忽略，类型不对或时间点不是整数时报错。时间点不做范围检查，负数也原样写给 NAS（G-161-07）。
- 播放会话（`playbackSessions.ts`）：入参不合法时的错误信息同 Go 版；每次取用成功后有效期顺延 24 小时。
- JSON 响应的响应头同 gin 的 `c.JSON`（`respond.ts`）。
- 上游请求（`upstream.ts`）每个单独建连接（`agent: false`），同 Go 版。`openUpstream` 返回还没 `end()` 的请求，调用方设好超时和事件后再 `end()`。
- Node 的 HTTP 服务器自己会给 MPV 写 `Keep-Alive`，夸克去掉逐跳头只保证这个头不是网盘给的值。
- 校验证书用 Node 自带的 CA 加上操作系统证书库，改了（U-17，`caCertificates.ts`）：Go 版用系统证书库，装在系统里的私有 CA 签发的 NAS 证书在 Go 版能过，这里也要能过。Node 只在进程启动后读一次系统证书库，所以 `tests/proxyServiceTls.test.cjs` 在新进程里运行 `tests/helpers/proxyTlsProbe.cjs`，证书经环境变量传入。只有 Linux 能用 `SSL_CERT_FILE` 在测试里装入私有 CA；Windows 和 macOS 要改系统设置，不测。
- 两个路由的 query 都只读 `session`（playvideo 还有 `sourceIndex`），query 不覆盖路径参数，body 里的 `session` 也当作多余字段，改了（U-13，不照搬 gin）。
