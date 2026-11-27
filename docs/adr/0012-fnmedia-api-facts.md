---
status: accepted
---

# 飞牛影视服务接口的外部事实与约定

记录客户端对接飞牛影视服务（`src/modules/fn_api/`）时，代码类型定义本身看不出的服务端字段约定与外部事实。

## 片头片尾信息（`play/setConfigByItem` 与 `play_config`）

- 写入接口 `/v/api/v1/play/setConfigByItem`（`SetSkipInfoData`）的 `guid` 字段填的是播放项的 `parent_guid`（例如季 GUID），不是播放项本身的 `guid`。
- `skip_opening` 是片头结束的时间点、`skip_ending` 是片尾开始的时间点，单位都是秒。
- `PlayInfo.play_config` 里这两个字段为 `null` 时表示不跳过。

## 字幕与播放项字段

- `PlayInfo.subtitle_guid` 为 `"no_display"` 时表示不显示字幕。
- 时间单位不统一：`ts`、`watched_ts`、`duration`（以及上文的 `skip_opening`、`skip_ending`）以秒计；`PlayInfo.item.runtime` 和 `PlayListItem.runtime` 以分钟计。
- `air_date` 为 `YYYY-MM-DD` 格式字符串。
- 多个布尔含义的字段在接口里用整数 `1` / `0` 表示：`is_favorite`、`is_watched`、`watched`、`can_play` 以及 `ItemListRequest.exclude_folder`。

## 请求层（`core/request.ts`）

- 请求从不 reject，结果是 `{ ok: true, data, movedTo? }` 或 `{ ok: false, failure: { kind, message } }`；`kind` 只有调用方会区分的 `certificate`、`https-port-mismatch`，其余都是 `failed`。`request()` 只在 `fn_api` 内部用，其它 module 通过 `FnApiClient`（主进程是 `ApiService`）调用。
- POST 和 PUT 的请求体里总要加一个随机的 `nonce` 字段（防重放），它和其它字段一起进 `Authx` 签名。
- 重定向不交给 axios（`maxRedirects: 0`），由 `request()` 自己跟随：新地址要按新的 baseUrl 重新签名、重新取访问授权 Cookie 和证书信任结果，重定向换了 origin 时，把最终的 baseUrl 作为成功结果的 `movedTo` 报给调用方，同一 origin 内换路径不报。重定向最多跟随 5 次，和访问码验证（ADR-0002）一致，超过时报「重定向次数过多」；跟随重定向不消耗 `retries`，`retries` 只管签名错误和网络错误的重试，所以 `retries: 0` 的调用（`tokenAccepted()`：启动时校验已保存的 token、FN ID 窗口检查 Cookie）遇到 80 跳 5666 之类的重定向也能到达目标（#278）。
- 调用方声明期望的响应类型：默认 JSON，字幕下载（`subtitle/dl`）用原始数据（`expect: 'raw'`）。期望 JSON 时只认 `Content-Type` 含 `application/json` 的响应，类型不对或缺失都按失败返回，消息里带状态码和实际的 `Content-Type`，不带响应体：网关或反向代理的 HTML 错误页不能算成功，也不能整页写进日志。期望原始数据时按文本读取响应体（axios 默认会把能解析成 JSON 的响应体转成对象），但 `Content-Type` 是 JSON 的响应仍按 fnAPI 的 `{ code, msg, data }` 处理，token 失效之类的业务错误不会被当成字幕内容（#279）。
- 端口和协议不匹配的错误不重试，重试结果不会变，作为失败种类 `https-port-mismatch` 返回，界面文案由登录决定。HTTPS 连到 HTTP 端口时服务器回的明文不是 TLS 记录：Electron 的 BoringSSL 报 `WRONG_VERSION_NUMBER`，Node 的 OpenSSL 报 `wrong version number`，两种都认（`core/httpsPortMismatch.ts`）。
- 调用方所在进程通过 `RequestContext` 提供依赖：主进程查进程内的访问授权和证书信任，Proxy 用播放会话里的值；`ca` 不传时用 Node 自带的 CA，Proxy 传入加上系统证书库的列表。
- `ApiClient` 带缓存的调用只缓存成功结果，与 Go 版一致：`ok` 为 `false`（NAS 返回非 0 的 `code`、网络错误等）都不缓存。
- 缓存（`core/ttlCache.ts`）替代 node-cache，只保留 `ApiService` 用到的 `get`、`set`、`del`。和 node-cache 一样：不传 ttl 时用默认值（默认 0），ttl 为 0 表示不过期，到过期时刻那一毫秒仍能读到。和 node-cache 不同：不拷贝值，`get` 返回 `set` 时的同一个引用，`ApiService` 靠这一点在同一个缓存里共享进行中的请求（`promise_<key>`，30 秒，失败时删掉，不缓存失败）；没有定时清理，`get` 时删掉读到的过期条目，`set` 时清掉全部过期条目。
- HTTPS 的 keepAlive 连接池按 TLS 设置（是否校验证书、超时）复用，不每次请求新建：常驻的 Proxy 里新建不销毁会让空闲连接越积越多。带 CA 列表的连接池按列表的引用区分（Proxy 一直用同一个列表），列表不再被引用时连接池随之回收。
- 证书错误按 Node/OpenSSL 的错误码识别（`core/certificateError.ts`），只在这个地址未被信任时作为失败种类 `certificate` 返回给上层弹窗；读取信任列表和弹窗依赖 Electron，在 `cert_trust`（见 ADR-0008）。
