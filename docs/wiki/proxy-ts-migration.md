# Proxy 改用 TypeScript

相关：[ADR-0004](../adr/0004-proxy-in-typescript-utility-process.md)、[ADR-0001](../adr/0001-mpv-bundle-and-runtime-ownership.md)、[发布与更新链路](release-and-update.md)、[多平台测试策略](multi-platform-testing.md)、[MPV IPC](mpv-ipc.md)。

## 2026-11-10 决定

- 维护者问 Go 在项目里的作用、能否换成 TypeScript。截至 `JayYa/fntv-electron@b1be458`，Go 只用于 Proxy（`src/modules/proxy`，非测试代码约 2260 行），Go 测试只有 6 个文件共 232 行，115 的 UA 和限流、夸克分片对齐、Range 请求重试都没有测试。
- 当天经 /grill-with-docs 逐项确认，维护者接受了全部建议：Proxy 改用 TS，用 `utilityProcess.fork()` 启动，控制走 `parentPort` IPC，HTTP 只留 `playvideo` 和 `skipinfo`；删除 Proxy 密钥、`proxy-secret` 文件、`/health`、孤儿复用和心跳；端口仍为 22345，因为 `fntv-mpv-config` 的 `local_packages/smart_skip/api.lua` 写死了这个地址；`fn_api` 拆出不依赖 Electron 的一层，和主进程共用；直接替换，不做新旧开关。理由和放弃的方案见 ADR-0004（当天草稿，`status: proposed`，未提交）。
- 当天发布 spec #158 和 9 张子票，阻塞关系用 GitHub 原生依赖：#159 拆层 → #160 会话和 NAS 本地取流 → #161 片头片尾 ‖ #162 直链和 NAS 中转 → #163 115 ‖ #164 夸克（都在 #162 之后）→ #165 切换并删除 Go（被 #161、#163、#164 阻塞）→ #166 三平台手动验收（`ready-for-human`，合并后、发版前）。#167（smart_skip 解析端口、Proxy 改随机端口，`needs-triage`）在 #165 之后，另行处理。
- 测试约定（spec #158）：只从 Proxy 服务模块测，端口和限流间隔可注入，上游用本地假 http 服务器，`node --test` 跑 `tests/*.test.cjs`、引用 `dest/` 的编译产物；冒烟测试改为请求不带 session 的 `playvideo`，并新增“端口已被占用”用例。

## 2026-11-10 执行计划

chief of staff 当天的计划（维护者待确认）：

1. 先由一个只读探索 subagent 把 Go Proxy 的每条可观察行为（状态码、转发和改写的请求头、重试和限流规则、Cookie 拼接、分片边界）列成清单，带 `file:line`，存在仓库外的笔记目录，供各票的实现 subagent 当作逐条对照和测试清单。原因：Go 测试覆盖很少，翻译时最容易丢的是没有测试的行为。
2. 按 implement-spec：从 `main` 建一个集成分支，每张票一个 worktree 里的实现 subagent（用 `tdd`），完成后由合并 subagent 合进集成分支，第一次合并后开 draft PR，关闭 #158 至 #165。ADR-0004 和本页随集成分支提交。
3. 全部票完成后在集成分支上跑 `code-review`，修复后 PR 转为 ready；#166 由维护者在合并后、发版前手测。

## 2026-11-10 Go 行为清单

- 当天只读探索 subagent 在 `b1be458` 上整理出清单，存放在仓库外的 `%TEMP%\proxy-ts-notes\go-behavior-inventory.md`。清单共 106 条行为，其中 14 条有 Go 测试，另有 22 条“不确定/疑似 bug”（U-01 至 U-22）。
- 和 spec、票对不上的地方：
  - #164：夸克路径不理会 Range 终点，总是返回从起点开始最多 10MiB（U-01）。上游请求不按分片对齐（U-02）。上游返回 200 时，起点大于 0 的请求会拿到错误的字节（U-03）。并发上限是死代码（U-04）。
  - #160：Range 重试只在上游返回 416 且请求为 `bytes=0-` 时做，只重试一次（U-11），并不是 spec 里说的“网络抖动时重试”。
  - #163：流信息里的 UA 对所有直连网盘都生效，不只 115（U-09）。
  - #161：skipinfo 写入负数时 Go 返回 200，写入接口 `play/setConfigByItem` 在 TS 的 `fn_api` 里还没有。
  - #159：Go 和 TS 两份 `Request` 有 8 处差异，拆共用层时要选定一个（U-12）。
- 隐私和安全问题：
  - 透明转发会把 MPV 的全部请求头都转给上游，请求头白名单没有起作用（U-05）。
  - 透明转发出错时，返回给 MPV 的错误详情带完整直链（U-10）。
  - 夸克路径原样转发上游的 hop-by-hop 头（U-14）。
- 迁移带来的风险：Go 用操作系统证书库，Node 默认用自带的 CA 列表，所以私有 CA 签的证书在 TS 版会校验失败（U-17）。
- 这些条目的处理方式当天交维护者决定，结论见下一节。

## 2026-11-10 维护者对清单的决定

当天维护者同意 chief of staff 的全部建议，同时决定暂不设每周的 wiki 检查。

- 默认规则：TS 版 Proxy 照搬 Go 的行为，测试断言最终选定的行为。
- 以下几条不照搬，改掉：
  - U-05：透明转发按请求头白名单转发。
  - U-10：错误详情里去掉 URL。
  - U-14：夸克路径去掉 hop-by-hop 头和 `Set-Cookie`。
  - U-03：修掉夸克上游返回 200 时的错误字节。
  - U-01：夸克路径返回 MPV 请求的区间，单次最多 10MiB。
  - U-06：夸克请求的总超时改为空闲超时。
  - U-17：加载系统证书，在 #160 实现并验证。
  - U-13：不照搬 gin 的 query 绑定覆盖路径参数和 body 字段。
- 以下几条照搬 Go，改票的说法：
  - U-02、U-04：从 #164 的验收里删掉“按分片对齐”和“并发上限”，改为单次最多 10MiB，同一请求内按顺序取。
  - U-11：Range 重试的说法改为“上游返回 416 且请求为 `bytes=0-` 时去掉 Range 重试一次”。
  - U-09：流信息里的 UA 对所有直连网盘生效。
- U-12：#159 的共用 `Request` 以 TS 版为准；唯一例外是访问授权 Cookie 由参数传入，因为 Proxy 进程里没有主进程那张 Map。Proxy 调 NAS 的行为和 Go 的差异留到 #166 手测时确认。
- 其余 11 条照搬 Go，并在测试里写明。
- 2026-11-10 已按这些决定修改 #158 和 #159 至 #164 的正文和验收条件，每张票各加一条评论，注明依据的 U 编号。标签、依赖关系和标题都没动，7 张票仍是打开状态。

## 2026-11-10 #159 完成

- 实现在分支 `feat/proxy-ts-159`（`51601d9`）上，`pnpm test` 共 402 条，401 通过、1 条按平台跳过，lint、knip、tsc 都通过。共用层放在 `src/modules/fn_api/core/`。
- 和票的写法不同的地方：
  - 访问授权 Cookie 和证书信任通过 `RequestContext` 里的函数 `(baseUrl) => …` 传入。这样跨 origin 重定向时会按新 origin 重新取，主进程的行为不变。
  - 日志由调用方传入，共用层不加载 `logger`，因此也不会间接加载 `electron`。
  - `isCertificateError` 和 `composeCookieHeader` 也移进了共用层。
- 没拆：`ApiService`（`api.ts`）还留在主进程那一层，因为它要用 `app.getPath('temp')`。chief of staff 当天决定由 #160 把 Proxy 需要的调用和缓存拆进共用层，字幕临时目录改为注入。
- 环境改进：“共用层不引用 `electron` 和 `logger`”目前只写在 `CODING_STANDARDS.md` 里。chief of staff 决定在 #160 里改用 ESLint 规则强制。

## 2026-11-10 #160 完成

- 分支 `feat/proxy-ts-160`（`f415a53`），3 个提交：
  - 拆出 `FnApiClient`，放进共用层；
  - 加 lint 规则，禁止共用层和 Proxy 服务引用 `electron` 和 logger；
  - Proxy 服务 `proxy_service/`。
- `pnpm test` 共 438 条，436 通过、2 条跳过，其中一条是新增的 Linux 系统证书测试，在 Windows 上跳过。这条测试实现者在 WSL 里手动跑过，CI 上还没有跑过。
- 清单 G-160 的 45 条里有 33 条写了 Node 测试，没写测试的 12 条都注明了原因（25–29 按 U-12 以 TS 版为准）。
- 和 Go 不同的地方（chief of staff 当天接受）：
  - MPV 不带 UA 时，上游收不到 UA；Go 会发 `Go-http-client/1.1`。
  - 500 响应的 `details` 只给错误码。
  - 直链媒体暂时按 NAS 本地取流转发，直链直连留给 #162。
- 遗留给 #165：`PlaybackSessionInput` 有三份定义，分别在 `proxySession.ts`、`proxy_service/playbackSessions.ts` 和 Go 里，接入客户端时合并成一份。
- 环境：
  - 提交钩子限制单个文件不超过 20000 字节，测试因此拆成 5 个 `tests/proxyService*.test.cjs`。
  - 测试证书放在 `tests/fixtures/tls/`，有效期 100 年，CA 私钥已删除。

## 2026-11-10 #161 完成

- 分支 `feat/proxy-ts-161`（`5cc7858`）。`pnpm test` 共 460 条，458 通过、2 条按平台跳过。清单 G-161 的 12 条都写了 Node 测试；U-20（写入失败最多重发 6 次）照搬 Go。
- 和 Go 不同的地方（chief of staff 当天接受）：
  - 请求体里的数字写成 `10.0` 时，TS 接受，Go 拒绝。
  - JSON 后面跟多余内容时，TS 返回 400，Go 忽略。
- 遗留问题：
  - `skipinfo.ts` 复制了一份 `playvideo.ts` 里的 `apiClient(session, deps)`，为的是不碰 #162 要改的文件。chief of staff 决定 #162 合并后由一个小任务抽成共用函数。
  - `fn_api/core` 的缓存会把失败结果也存 300 秒，Go 只缓存成功的结果。这样一次 `play/info` 失败，之后 5 分钟内写回和取流都会失败。chief of staff 当天决定在同一个小任务里改成不缓存失败结果；主进程也会跟着变，已告知维护者。
- 2026-11-10 #161 合并进集成分支（`0345032`），PR #168 上四项 CI 都通过。

## 2026-11-10 #162 完成

- 分支 `feat/proxy-ts-162`（`fe9a95d`）。`pnpm test` 共 452 条，450 通过、2 条按平台跳过。清单 G-162 的 14 条里有 13 条写了 Node 测试，没写的是 120 秒响应头超时（和 #160 共用同一段转发代码）。
- 和维护者决定不同、待维护者确认：U-15。直链 path 里的编码原样发给网盘，没有照搬 Go 的重新编码，理由是照搬会让带签名的直链失效。chief of staff 建议接受。
- chief of staff 当天接受的改动：
  - 直链 URL 里带账号时总是补上 Basic 认证，因为按 U-05，MPV 的 Authorization 不再转发。
  - `StreamResponse.header` 新增可选的 `User-Agent`，`Cookie` 允许为 null。
- 留给 #163、#164 的接入位置：`playvideo.ts` 的直连分支按 `directLink.cloudType` 区分，115（3）和夸克（4）暂时仍走透明转发。
- 没有测试：直连路径使用系统证书库（U-17）。
- 2026-11-10 #162 合并进集成分支（`645821d`），没有冲突，PR #168 上四项 CI 都通过。同日维护者确认 U-15 按 chief of staff 的建议处理：直链 path 里的编码原样发给网盘，不照搬 Go 的重新编码。

## 2026-11-10 #163 完成

- 分支 `feat/proxy-ts-163`（`ea8dc0b`），新增 `src/modules/proxy_service/cloud115.ts` 和 `tests/proxyService115.test.cjs`（6 条测试）。`pnpm test` 共 480 条，478 通过。把限流间隔改成 0 时，有 3 条测试失败，说明测试确实测得到限流。
- 清单 G-163 的 5 条都写了测试，U-08、U-09、U-19 照搬 Go。
- 限流测试不比较相邻两次请求的时间差，因为本机连接会有约 20ms 抖动。测试改为断言第 k 个请求到达不早于开始时刻加 k 个间隔。
- 2026-11-10 #163 合并进集成分支（`fd70b9c`），PR #168 上四项 CI 都通过。

## 2026-11-10 #164 完成

- 分支 `feat/proxy-ts-164`（`575957f`，已包含 #163）。`pnpm test` 共 501 条，499 通过。
- 清单 G-164 的 16 条里有 15 条写了 Node 测试。没写的是 200 分钟的元信息缓存 TTL，因为服务没有可注入的时钟。
- 不照搬 Go 的 U-01、U-03、U-06、U-14 按票的验收写了测试；U-02、U-04 照搬 Go。
- chief of staff 当天接受的几处：
  - Range 终点小于起点时照搬 Go，从起点返回最多 10MiB，不返回 416。
  - 网盘忽略 Range、返回 200 时，Proxy 先读掉起点之前的字节再丢弃（这是修 U-03 的代价）。
  - 夸克第一次请求会多发一个 `bytes=0-0`，所以 #163 的“其它网盘不限流”测试计数时排除了这个请求。
- 新增注入点 `quarkIdleTimeoutMs`，和 `TESTING_STANDARDS.md` 第 27 行“不为测试新增接缝”冲突。chief of staff 当天决定接受：它和限流间隔一样，都是时间参数，不注入就只能真等 60 秒。同时决定在下一个小任务里修改标准，写明时间类参数（超时、间隔）可以作为可选参数注入。
- 2026-11-10 #164 合并进集成分支（`ae7a0f5`），PR #168 上四项 CI 都通过。

## 2026-11-10 复盘 #160、#164 实现会话

复盘由只读 subagent 完成，对象是两个实现会话的记录（#160 约 20 分钟，#164 约 13 分钟）。chief of staff 当天的处理：

- 要做：
  - `pnpm test` 加 `--test-timeout`。#164 的红测试卡了约 2 分钟，最后靠手动停掉。
  - 单文件 20000 字节的检查接进 lint 和 CI。目前只有提交钩子检查，#160 到提交时才被拦下。
  - 把 `TESTING_STANDARDS.md` 第 21 行“只在本机 Windows 通过不算通过”改为：按平台跳过的测试由 CI 三平台验证。#160 为了在本地跑 Linux 测试，从网上拉了非官方的 Node 和 apk。
  - 以上三项在清理任务合并后，派一个环境任务一起做。
- chief of staff 自己调整派单方式：
  - 并行派单时，在 brief 里写明对方会改变、可观察到的行为。#164 合并 #163 后，“其它网盘不限流”测试的上游请求计数不再成立。
  - 查 issue 改用 `docs/agents/issue-tracker.md` 里的命令。
  - 合并提交写成 `chore(scope): 合并 …`。#164 用 `merge:` 被 commit-msg 钩子拒绝了一次。
- 待维护者决定：两个会话都用 heredoc 或 `node` 替换脚本写源码，反复出错，全局 CLAUDE.md 里“用 Write、Edit”的约定没有起作用。复盘建议在用户全局 `~/.claude/settings.json` 加一个 PreToolUse hook，拦截写入 `src/`、`tests/` 的 shell 重定向和 `writeFileSync`。这是维护者的个人配置，不在仓库里。
