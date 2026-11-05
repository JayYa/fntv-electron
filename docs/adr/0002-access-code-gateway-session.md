# 访问码是网关凭据，下游只拿 Cookie

访问码属于 fnOS 网关，不是 `/v/api/v1/login` 的字段，FNMedia token 仍是应用凭据。所以由主进程单独完成网关验证，把得到的会话 Cookie 作为内存中的访问授权交给下游，下游不接触也不重新编码明文访问码。只把访问码加进登录请求的话，内嵌页面、后台 API 和播放 Proxy 都过不了网关。

## 数据流

1. 登录页通过受限的 `login` IPC 频道，把可选的 `accessCode` 和账号凭据一起发给主进程。
2. `establishAccessCodeSession`（`src/main/common/accessCodeSession.ts`）用 `persist:fntv` 会话请求 `GET /access_code_verify`，请求头是 `x-access-code`（UTF-8 后 Base64）和 `x-access-source: web`。
3. 验证后记下最终 origin，把该会话的 Cookie 存成按 origin 区分的内存授权（`src/modules/fn_api/accessGrant.ts`）。`mode` 和 `trim-mc-token` 不进授权。
4. `ApiService` 在签名的 FNMedia 请求上附加授权 Cookie，从不附加明文访问码。
5. 登录成功后，访问码经 `safeStorage` 写入当前配置和历史。启动时先重新验证，再恢复 token；验证失败回到登录页。
6. 创建播放会话时，授权 Cookie 随 `POST /api/v1/session` 进入 Proxy，这个请求受 `X-FNTV-Proxy-Secret` 保护。
7. Proxy 把 Cookie 加到 FNMedia API 和本地 NAS 范围请求上。云盘直连只用云盘自己的 Cookie。

## 契约

- 访问码先去除首尾空白。空访问码不验证、不产生授权，登录流程保持原样。
- 每次验证都先清空已有授权，因为应用同时只有一个登录。
- 重定向只允许同主机，不允许 HTTPS 降级到 HTTP，最多 5 次，整个请求 10 秒超时。这防止访问码被发到其它主机，同时支持常见的 80 到 5666 端口跳转。
- `401`、`403`、`429` 视为访问码被拒绝，用户看到“访问码错误”。其它非 2xx、网络错误，以及 2xx 但没有拿到 Cookie，都按网络失败处理，和账号密码错误区分开。
- Cookie 由 `composeCookieHeader` 结构化组合，`mode=relay` 只出现一次。Go 侧的 `ComposeCookieHeader` 要保持一致。

## FN ID 登录

FN ID 窗口是隔离的。访问码只在当前页面是 fnOS 访问码页时注入脚本，用于自动填写。拿到目标 FNMedia origin 后，主进程再建立和直接登录相同的授权。

## 存储与暴露范围

- 当前配置和历史里的访问码都由 `safeStorage` 加密。没有 `accessCode` 的旧历史记录读出来是空值。
- 当前访问码解不开时，`readConfig` 连同 token 一起按未登录返回，启动回到登录页，不跳过网关。两者的密文都保留，密钥恢复后还能用。
- 访问码不进日志、URL、命令行参数和环境变量，也不出现在 Proxy 响应里。派生的 Cookie 不出现在播放会话 URL 里。
- `config-data` 不含密码、访问码和 token。当前配置只带 `hasAccessCode` 布尔值，`history` 只带 `domain`、`account` 和 `useHttps`。
- 明文凭据按需发给本地登录页：用户点击历史时走 `get-history-credentials`，当前配置有访问码时走 `get-current-access-code` 回填表单。主进程校验 `senderFrame` 是本地 `file:` 登录页，其它来源不回复。回复带域名和账号，登录页丢弃对不上的回复。解不开的凭据是空值，表单留空由用户手动输入。
- 按需频道减少的是登录页内存里常驻的明文，防不了登录页自身被注入：注入的脚本同样能发这些请求，只是要逐条取。当前访问码在打开登录页时就会回填，和改动前一样留在表单里。
- 配置里的 token 不经 IPC 发给渲染进程，但它不是只留在主进程：`Trim-MC-token` Cookie 是 `httpOnly: false`，飞牛网页前端要读取它（`src/modules/fn_config/cookie.ts`），所以远程页面的脚本能读到 token。

## Consequences

新增的持久化字段都是可选的，旧配置可以继续读取。回滚时忽略这些加密字段，移除辅助调用即可，不需要数据迁移。
