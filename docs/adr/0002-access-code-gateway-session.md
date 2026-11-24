# 访问码是网关凭据，下游只拿 Cookie

访问码属于 fnOS 网关，不是 `/v/api/v1/login` 的字段，FNMedia token 仍是应用凭据。所以由主进程单独完成网关验证，把得到的会话 Cookie 作为内存中的访问授权交给下游，下游不接触也不重新编码明文访问码。只把访问码加进登录请求的话，内嵌页面、后台 API 和播放 Proxy 都过不了网关。

## 数据流

1. 登录页通过受限的 `login` IPC 频道，把可选的 `accessCode` 和账号凭据一起发给主进程。
2. `establishAccessCodeSession`（`src/main/common/accessCodeSession.ts`）用网页端会话（`WEB_UI_SESSION_PARTITION`，`src/main/common/webUiSession.ts`）请求 `GET /access_code_verify`，请求头是 `x-access-code`（UTF-8 后 Base64）和 `x-access-source: web`。
3. 验证后记下最终 origin，把该会话的 Cookie 存成按 origin 区分的内存授权（`src/modules/fn_api/accessGrant.ts`）。`mode` 和 `trim-mc-token` 不进授权。
4. `ApiService` 在签名的 FNMedia 请求上附加授权 Cookie，从不附加明文访问码。
5. 登录成功后，访问码经 `safeStorage` 写入当前配置和历史。启动时 `restoreAtStartup`（`src/main/common/currentLogin.ts`）先重新验证访问码，再校验已保存的 token、写入网页端会话；任一步失败回到登录页。
6. 创建播放会话时，`currentConnection()` 给出当前登录和它的授权 Cookie，授权 Cookie 经 IPC 进入 Proxy 子进程（ADR-0004）。
7. Proxy 把 Cookie 加到 FNMedia API 和本地 NAS 范围请求上。云盘直连只用云盘自己的 Cookie。

## 契约

- 访问码先去除首尾空白。空访问码不验证、不产生授权，登录流程保持原样。
- 每次验证都先清空已有授权，包括之前经端口跳转发现的 origin，因为应用同时只有一个登录。
- 重定向只允许同主机，不允许 HTTPS 降级到 HTTP，最多 5 次，整个请求 10 秒超时。这防止访问码被发到其它主机，同时支持常见的 80 到 5666 端口跳转。
- `401`、`403`、`429` 视为访问码被拒绝，用户看到“访问码错误”。其它非 2xx、网络错误，以及 2xx 但没有拿到 Cookie，都按网络失败处理，和账号密码错误区分开。
- Cookie 由 `composeCookieHeader` 结构化组合，`mode=relay` 只出现一次。主进程和 Proxy 共用这一个实现（`src/modules/fn_api/core/cookie.ts`）。

## FN ID 登录

FN ID 窗口是隔离的。FN Connect 运行时才返回 NAS 地址，窗口离开 FN Connect 时到达的第一个地址就是目标 origin（`src/main/handlers/core/fnIdTrust.ts`）。访问码只在页面属于这个 origin，而且是 fnOS 访问码页时注入脚本，用于自动填写。拿到目标 FNMedia origin 后，主进程再建立和直接登录相同的授权。

渲染窗口遇到证书错误（`app` 的 `certificate-error`）时，不在信任列表里的地址也弹窗问用户，不直接拒绝：FN Connect 跳到使用自签名证书的 NAS 时，直接拒绝会静默白屏。

确认后的跳转沿用上面的重定向规则：只允许同主机，不允许 HTTPS 降级到 HTTP。例外是 NAS 在 `sys/config` 里报告的 `nas_oauth.url`，它可以换主机，但同样不能降级；不满足时留在当前 origin。

页面信任判断的细节（`fnIdTrust.ts`、`fnIdOauthWindow.ts`）：

- FN Connect 返回的 NAS 地址可能是局域网 IP、公网 IP、DDNS 或中继，无法预先列白名单，所以按上面的“第一个地址”确认目标，之后只有这个 origin 能拿到凭据。`5ddd.com/{fnId}` 路径下的页面视同 NAS 页面（`fnConnect.ts`）。FN Connect 停在 `5ddd.com/{fnId}` 时，API 的 base URL 要保留 FN ID 这段路径（`resolveFnConnectBaseUrl`）。
- FN Connect 只认 HTTPS 的 `5ddd.com`、`www.5ddd.com` 和 `check.fnos.net`：离开这些页面后的第一个地址会被确认为目标，明文页面的跳转可以被篡改。`check.fnos.net` 是旧版 NAS 的探测页，它的 HTTP 地址因此被拒绝，旧版 NAS 不再支持 FN ID 登录（#57）。FN Connect 页脚的外链（`fnnas.com` 等）不是 NAS 地址。
- NAS 页面能运行拦截脚本、填写访问码、向主进程发消息；其中只有登录页能填写明文密码。主进程判断页面和脚本执行之间页面可能已经换了，所以自动填写脚本（`getLoginAutofillScript`，`fnIdScripts.ts`）先核对 origin 再读取凭据。
- FN Connect 的地址选择页用 `target="_blank"` 打开 NAS，这种弹窗改在当前窗口继续，其它弹窗一律拒绝。FN Connect 用隐藏 iframe 探测 NAS 地址，子框架的跳转不算窗口导航，只有主框架的 `will-redirect` 按导航规则检查。
- 页面经 `console-message` 的 `__FNTV_BRIDGE__:` 前缀给主进程发消息。任何页面都能打印这个前缀，所以只听 NAS 页面的主框架。
- 每次登录用新的临时分区（`fnid-oauth-<时间戳>`），旧 token 不会被当成本次登录的结果。分区里确认目标前只认中继页的 Cookie，确认后只认目标 NAS 的 Cookie。中继页不看 Cookie 的路径：真实中继没有验证过，路径猜错会让中继登录失败。确认目标后中继的 Cookie 不再可用：它不是目标 NAS 的 token，放弃后还能走 OAuth。取到的 token 还要过 NAS 的用户信息接口，这里只排除其它站点的 Cookie。
- 日志只记页面的路径和 hash 路由：查询串里可能有授权码和 `state`，FN Connect 的路径就是 FN ID，也不记。被忽略的登录 Cookie 只记域、不记值，登录走不通时靠这行判断是不是误拒。

## 存储与暴露范围

- 当前配置和历史里的访问码都由 `safeStorage` 加密。没有 `accessCode` 的旧历史记录读出来是空值。
- 加密（`src/modules/fn_config/credentialCrypto.ts` 的 `encryptAll`）没有要加密的明文时不检查安全存储；存储不可用或只有 `basic_text` 时抛错，一个都不加密。写回磁盘的值（`storedValueOf`）要求要加密的明文已在 `encryptAll` 的结果里。
- Electron 45 的同步 API 写的密文格式是 `safe-storage:v1:` 加 `encryptString` 结果的 base64，`tests/helpers/credentialConfig.cjs` 按这个格式造旧密文。
- 当前访问码解不开时，`readCurrentLogin` 连同 token 一起按未登录返回，启动回到登录页，不跳过网关。两者的密文都保留，密钥恢复后还能用。
- 访问码不进日志、URL、命令行参数和环境变量，也不出现在 Proxy 响应里。派生的 Cookie 不出现在播放会话 URL 里。
- `config-data` 不含密码、访问码和 token。当前配置只带 `hasAccessCode` 布尔值，`history` 只带 `domain`、`account` 和 `useHttps`。
- 写进网页端会话的 `Trim-MC-token` 不设 `httpOnly`：飞牛网页前端读这个 Cookie 维持路由和 API 登录态。远程页面已由 `contextIsolation`、关闭 `nodeIntegration` 与本机能力隔离。同时写 `mode=relay`，FN Connect 外网访问要它。
- 明文凭据按需发给本地登录页：用户点击历史时走 `get-history-credentials`，当前配置有访问码时走 `get-current-access-code` 回填表单。主进程校验 `senderFrame` 是本地 `file:` 登录页，其它来源不回复。回复带域名和账号，登录页丢弃对不上的回复。解不开的凭据是空值，表单留空由用户手动输入。
- 按需频道减少的是登录页内存里常驻的明文，防不了登录页自身被注入：注入的脚本同样能发这些请求，只是要逐条取。当前访问码在打开登录页时就会回填，和改动前一样留在表单里。
- 配置里的 token 不经 IPC 发给渲染进程，但它不是只留在主进程：`Trim-MC-token` Cookie 是 `httpOnly: false`，网页端要读取它（`src/main/common/currentLogin.ts` 写入网页端会话），所以远程页面的脚本能读到 token。

## 配置文件（`src/modules/fn_config/configFile.ts`、`loginStore.ts`）

- 顶层不是对象的 JSON 和语法错误一样算损坏：读出来会丢内容，被替换前要留底。备份用复制而不是改名，写入失败时 `config.json` 还在；先写完临时文件再备份，写不下去时不占备份名额，rename 之前 `config.json` 始终是旧内容。备份含密文，日志只记文件名；备份落盘后清理旧备份失败不影响这次写入。
- 读当前登录时把旧格式凭据迁移到安全存储；迁移失败不影响这次读取，旧值留在磁盘上，下次读取时重试。
- 保存当前登录总是重新加密新凭据，安全存储不可用时抛错、文件不变。解不开的旧 token 和访问码被这次的值替换，所以保存时 token 不能为空；退出登录用 `clearToken`，只清 token，保留账号、地址、访问码和 HTTPS 设置，token 本身解不开时原样留着，由之后的登录替换。新登录和登录历史在同一次写入里，要么都写上，要么都没写。
- 访问码验证通过后的地址（`GrantedBaseUrl`）记着访问码：访问授权被之后的验证或结束当前登录清掉时，用它重新验证，保存当前登录时也写它。

## Consequences

新增的持久化字段都是可选的，旧配置可以继续读取。回滚时忽略这些加密字段，移除辅助调用即可，不需要数据迁移。
