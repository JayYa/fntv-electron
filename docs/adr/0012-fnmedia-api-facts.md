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

- POST 和 PUT 的请求体里总要加一个随机的 `nonce` 字段（防重放），它和其它字段一起进 `Authx` 签名。
- 重定向不交给 axios（`maxRedirects: 0`），由 `request()` 自己跟随：新地址要按新的 baseUrl 重新签名、重新取访问授权 Cookie 和证书信任结果，并把新的 baseUrl 作为 `moveUrl` 报给调用方。重定向最多跟随 5 次，和访问码验证（ADR-0002）一致，超过时报「重定向次数过多」；跟随重定向不消耗 `tryTimes`，`tryTimes` 只管签名错误和网络错误的重试，所以 `tryTimes=0` 的调用（启动时校验已保存的 token、FN ID 窗口检查 Cookie）遇到 80 跳 5666 之类的重定向也能到达目标（#278）。
- 端口和协议不匹配（`isHttpsPortMismatch`）的错误不重试，重试结果不会变。
- 调用方所在进程通过 `RequestContext` 提供依赖：主进程查进程内的访问授权和证书信任，Proxy 用播放会话里的值；`ca` 不传时用 Node 自带的 CA，Proxy 传入加上系统证书库的列表。
- HTTPS 的 keepAlive 连接池按 TLS 设置（是否校验证书、超时）复用，不每次请求新建：常驻的 Proxy 里新建不销毁会让空闲连接越积越多。带 CA 列表的连接池按列表的引用区分（Proxy 一直用同一个列表），列表不再被引用时连接池随之回收。
- 证书错误按 Node/OpenSSL 的错误码识别（`core/certificateError.ts`），只在这个地址未被信任时作为 `certificateError` 返回给上层弹窗；读取信任列表和弹窗依赖 Electron，在 `cert_trust`（见 ADR-0008）。
