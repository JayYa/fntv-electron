# 历史遗留 issue 分诊

相关：[独立维护](independent-maintenance.md)、[发布与更新链路](release-and-update.md)。来源：issue #28 至 #35，以及 2026-11-05 的只读核实报告（子代理 `a88263d0438c43a79`）。

## 2026-11-05 推荐顺序（chief of staff，维护者已确认，见下方决定）

1. #33 行尾。此时没有 open PR，renormalize 的成本最低。
2. #30 和 #35 小修，顺带修 `CODING_STANDARDS.md:28` 的坏正则。
3. #29 解密失败。
4. #28 明文凭据，以及 FN ID 注入（尚未开 issue）。
5. #31 的 CSP 部分。
6. #34 lint。
7. #31 的 sandbox 部分。

#32 按维护者 2026-11-05 的决定暂缓。

核实报告原本建议先做 #29 和 #28。chief of staff 把 #33 提前，理由是项目未公开发版、时间不紧，而 renormalize 要避开跨分支冲突。

## 2026-11-05 事实（`JayYa/fntv-electron@6be8d03`）

测试基础：

- `pnpm test` 67/67 通过，`go test ./...` 通过。
- `tests/` 没有 auth、preload、winctrl 的测试，也没有 DOM 或 Electron 运行时测试。
- safeStorage 可用 `Module._load` mock（`tests/helpers/credentialConfig.cjs`）。
- 用假 `ipcMain` 可以跑真实 `auth.init()`。

#29：

- 已用真实 Electron 38 验证：启动时一条坏密文会让 `tray.ts:16` 抛错，`main.ts:101-103` 随后 `app.quit()`，结果是无窗口、无对话框的静默退出。
- 推断：如果只把失败项清空，setter 的 read-modify-write 或 `config.ts:173` 的迁移写回会把密文永久写成空串。Linux 密钥环临时锁定时凭据会真的丢失。

#28：

- `auth.ts:45` 当前配置的 accessCode 也是明文发送。
- `fnid_login.ts:61,337` 在每次 `did-finish-load` 向 OAuth 窗口主世界注入明文密码，读代码未见 URL 校验或 `will-navigate` 限制。这一条未做运行验证。
- `cookie.ts:57` 的 Trim-MC-token 是 `httpOnly:false`，与“长期 token 不发给渲染进程”的说法不严格一致。
- `config.ts:384` 的 `module.exports =` 覆盖 ES export，新函数不加进这张表时运行时是 undefined，tsc 查不出。

#31：

- 已实测 `sandbox:true`：`electron.shell` 不存在，`preload/index.ts:66` 的 openExternal 要移到主进程 IPC。
- 临时副本用 esbuild 打包 preload 得到 26.5KB，沙箱下 `electronAPI` 正常。真实 fnOS 页面未测。
- 登录页只有 1 个内联 script（`index.html:1006-1666`），内联事件处理器为 0。
- 测试中 `rendererIsolation:20,23` 是 doesNotMatch，脚本外置后不改会空转通过。

#33：

- 3 个混合、6 个 CRLF，不需要 Windows 例外。
- 临时 clone 模拟：renormalize 只改这 9 个文件和 `.gitattributes`。

#34：

- 小规则集现存 57 条违规，涉及 18 个文件，其中 unused-vars 52 条。
- `CODING_STANDARDS.md` 的可机器化规则多数是 grep 型，适合 CI 脚本或 `tests/*.cjs`，不适合 ESLint。
- issue 举的两条规则在 HEAD 已不在标准文档里。

## 2026-11-05 issue 之外的发现

- `CODING_STANDARDS.md:28` 的验证命令 `'(alert|confirm|prompt)('` 是坏正则，`git grep` 报 fatal。由 `46340cc` 引入。
- 推断：`config.ts:178` 遇 SyntaxError 返回 null，下一次 setter 会用 `{}` 覆盖整份配置。
- `plugins/config.ts` 的 IPC handler 没有 try/catch。
- 推断：`compile` 不清理 `dest/`，已删除插件的旧 js 仍会被 readdirSync 加载。

## 2026-11-05 维护者决定

维护者确认了上面的顺序，并同意：

- #29 解密失败的字段在内存里按未登录处理，保留原密文，不写回空串。这取代 #29 正文的建议 1。
- FN ID 注入拆成 #37，与 #28 同批。上面“尚未开 issue”的说法已被取代。chief of staff 开 issue 前读过 `fnid_login.ts`，确认注入前没有 origin 校验，也没有 `will-navigate` 限制。
- 配置读写和构建产物的小问题合并为 #38，排在 #29 之后。
- 一个 issue 一个 PR，由子代理实现，从 #33 开始。#31 拆成两个 PR。

同日，#28、#29、#31、#34 补了核实评论并改为 `ready-for-agent`。依赖写成了 GitHub 原生关系：#28 被 #29 阻塞，#31 被 #28 阻塞，#34 被 #33 阻塞，#38 被 #29 阻塞。

## 2026-11-05 进度（`JayYa/fntv-electron@c7e8b24`）

- 维护者合并了 PR #39（#33，merge commit `905d2de`，保留了 `5c0edbb`，`.git-blame-ignore-revs` 有效）、PR #40（#30）、PR #41（#35）。
- 未实际运行：`generate-icns`（需要 macOS 的 `iconutil`）和 Linux 打包。
- `CODING_STANDARDS.md:28` 原来的 `\b` 是 0x08 退格字节，PR #40 一并修正。
- 待确认：`.gitignore` 的 `docs` 规则是否影响 `docs/` 下的新文件。`docs/wiki/legacy-issues-triage.md` 新增时 `git status` 能看到，子代理的“需要 `git add -f`”未验证。
- 未处理：`generate-iconset.js` 的回退分支写死“在 Windows 环境下”，还会写入假 PNG 占位文件。

## 2026-11-05 #29 合并（`JayYa/fntv-electron@f0d3cad`）

- 维护者合并了 PR #42。解不开的凭据读出来是空值，原密文挂在 `config.ts` 私有 symbol 上，`writeConfig` 原样写回。
- 维护者接受三点取舍：登出不清解不开的密文；带新 token 且访问码为空的保存算重新登录；迁移写回失败只记日志。
- 第一点的依据：`clearLoginCookies` 除登出（`login.ts:78`）外，还由 `/v/login` 请求路径（`login.ts:55`）触发，不一定是用户主动操作。
- 未验证：Linux 密钥环真实锁定的表现、打包版日志目录、真实 Proxy 下的启动。

## 2026-11-05 #28 合并，#37 待冒烟（`JayYa/fntv-electron@771a62e`）

- 维护者合并了 PR #43。`config-data` 不再含密码和访问码，明文走按需频道，主进程用 `isLoginPage` 校验来源。当前访问码仍会在打开登录页时回填，明文进登录页表单。
- 未验证：打包版 `app.asar` 路径下的来源校验。读代码判断与 `loadFile` 同基准。
- PR #44（#37）实测修复前假恶意站点能收到密码和访问码。NAS 地址由 FN Connect 运行时返回，列不出白名单，改为确认首个目标 origin 后只允许同主机跳转。
- PR #44 未用真实 FN ID 账号验证，跳转链和登录路径是读 bundle 推断的。`http://check.fnos.net` 仍被信任，是已知缺口。
- 待开 issue：取 `Trim-MC-token` 时不限定 origin；`isFnId` 不排除 `/`、`?`、`#`。

## 2026-11-05 #37 真实冒烟（`JayYa/fntv-electron@222f47e`）

- 维护者用真实 FN ID 账号测试。局域网 IP 和 `fnos.net` 公网域名都登录成功。3 次失败是维护者的网络问题，由维护者主动关窗。
- 日志确认真实链路是 `/{fnId}`、`/`、`/login`、`/signin`、`/v/oauth/result`，`/login` 判定为登录页。这取代了 PR #44 中“读 bundle 推断”的说法。
- 维护者确认 OAuth 窗口的账号和密码被自动填好。此前“手动输入”的回答指的是别的步骤，自动填写没有回归。
- 未解释：23:49 那次注入后 19 秒才拿到 Cookie，自动提交是否生效未确认。填写脚本与 `main` 逻辑相同。
- 23:50 直连登录的两次密码错误是维护者手动输入的，与 #43 无关。
- 未验证：中继（维护者没有这个选项）、访问码 NAS、旧版 NAS、`nas_oauth.url` 不为空。
- `222f47e` 增加了页面判断和弹窗拒绝日志，不记录查询串和凭据。

## 2026-11-06 进度（`JayYa/fntv-electron@f2a4db0`）

- 维护者合并了 PR #44（#37）和 PR #46（#31 的 CSP 部分）。#31 仍开着，等 sandbox 部分。
- PR #46 未运行打包版，只确认 `app.asar` 里有 `index.html` 和 `index.js`。
- #37 的遗留点开成 #45。
- chief of staff 把 #38 排到 #34 之前，理由是它修配置被覆盖的风险，用户影响更大。

## 2026-11-06 #38 合并（`JayYa/fntv-electron@8fc218c`）

- 维护者合并了 PR #47，含配置损坏备份、原子写、IPC 统一捕获、`compile` 清理 `dest`、`history` 形状校验。维护者接受了三点取舍：配置损坏时不弹提示；备份留 3 份、含密文；解不开的历史条目最后淘汰。
- 未验证：打包版、真实 Electron 的失败路径、杀毒软件占用时的 rename。

## 2026-11-06 复盘（chief of staff）

取样 #37、#38 两次子代理工作，以及 CODING_STANDARDS 坏命令的来源。

- 信息获取：#37 的冒烟清单靠 FN ID 日志判断，但日志当时不记录页面判断，chief of staff 因此对路径作了错误猜测，维护者多跑了一轮。PR `222f47e` 已补日志。教训：写手工冒烟清单时，同时确认每一项能从日志判定。
- 自动检查：`config.ts` 的 `module.exports =` 会让新函数运行时为 undefined，tsc 查不出。这是机械问题，交给 #34 处理。
- 自动检查：`CODING_STANDARDS.md` 的验证命令坏了也没人发现（`46340cc`）。文档里的验证命令应当由测试实际运行，交给 #34 处理。
- 审查：本轮 PR 只有 chief of staff 抽查和维护者审查，没有独立的 code-review 子代理。安全相关 PR 开出后先跑 `code-review`，从 #31 sandbox 开始执行。

## 2026-11-07 #34 合并（`JayYa/fntv-electron@5fac5e4`）

- 维护者运行应用后合并了 PR #48。`log/app.log` 里 2026-11-07 00:09 那次启动和直连登录成功，只有已知的两条：`fnid_login.js` 没有 init，以及 worktree 缺 MPV 配置目录。
- `config.ts` 和 `cookie.ts` 改成纯 ES export，`module.exports =` 被 lint 禁止，`docs/wiki` 里此前关于导出表的坑已被取代。
- 文档里的“验证：”命令由 `tests/standards.test.cjs` 实际运行。

## 2026-11-07 #45 合并和文件大小限制（`JayYa/fntv-electron@cc1d785`）

- 维护者用真实 FN ID 走局域网登录成功后合并了 PR #50。这次走的是 OAuth 授权码路径，“检测到有效登录 Cookie”路径未被真实流程覆盖。
- 维护者要求在继续其他 issue 前加 pre-commit 检查：暂存文件不超过 5,000 tokens（字节数 / 4），跳过非 agent 写的文件，错误信息要写清拆分方法。
- 截至 `cc1d785`，agent 写的超限文件有 `fnid_login.ts`、`resource/login/index.html`、`resource/login/index.js`、`tests/credentialStorage.test.cjs`。下次改动它们时要先拆分。

## 2026-11-07 超限文件拆分

- 上面列出的 4 个超限文件已按职责拆分，纯搬移。本文更早条目里的行号是当时的快照，不再对应现在的文件。
- `fnid_login.ts` 只留 `isFnId` 和入口，注入脚本、bridge 消息和 OAuth 窗口流程在 `src/main/handlers/core/` 的 `fnIdScripts.ts`、`fnIdOauthMessages.ts`、`fnIdOauthWindow.ts`。
- 登录页样式在 `resource/login/index.css`，脚本按 `index.html` 的 `<script src>` 顺序加载。
- `tests/credentialStorage.test.cjs` 按行为拆成 `tests/credential*.test.cjs`，假对象在 `tests/helpers/credentialConfig.cjs`。

## 2026-11-07 拆分和 #49 合并（`JayYa/fntv-electron@f36e184`）

- 维护者用真实 FN ID 和直连登录验证后合并了 PR #52（文件拆分），随后合并了 PR #53（#49）。
- 登录页改为 7 个经典脚本加 `index.css`，`file:` 下不能用 `type="module"`。
- HTTPS 连到 HTTP 端口时不再重试，直连登录有可读提示。访问码和 FN ID 路径的文案未改。

## 2026-11-07 #31 sandbox 的事故和审查（`JayYa/fntv-electron@ca1555a`）

- 事故：实现子代理验证打包版时，真实应用用维护者已保存的登录状态启动，01:51:58 连上真实 NAS，约 20 秒后被杀。任务明确要求不碰真实 `~/.fntv`。
- 影响：`~/.fntv/Partitions/fntv` 下 29 个缓存和会话文件被改，`%APPDATA%\fntv\logs\app.log` 被追加。`config.json` 和 `proxy-secret` 未变。日志里没有播放、登出或标记操作。此前一次 110 秒的运行没有日志，不能排除也写过。没有备份，未修复。
- 原因：`app.isPackaged` 下应用固定用 `~/.fntv`，子代理误以为 `resources/app` 优先于 `app.asar`。之后改用缺 `T_HOME` 就退出的入口。
- 教训：打包版不要直接运行，除非入口强制隔离 home。
- `code-review` 发现后已修：桥拆到 `loginPageApi.ts` 并排在插件之前；外链拒绝账号密码和非默认端口；外链日志不记路径；logger 的回退改为等待 invoke；`package.json` 断言移到 `tests/standards.test.cjs`。
- 这些修复之后没有再跑真实 Electron，只跑了 lint 和 `pnpm test`。
