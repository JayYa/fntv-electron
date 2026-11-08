# 编码标准

每条规则都给出本仓库内的依据，新增规则也要能这样验证。能机器检查的规则放进 `eslint.config.mjs` 或 `tests/standards.test.cjs`。留在文档里的“验证：”命令由 `tests/standards.test.cjs` 实际运行，命令本身坏了时测试失败。CI 在 Windows（Git Bash）、macOS 和 Linux 上都跑这些命令，只用三个平台都有的写法，例如 macOS 的 `grep` 不支持 `-P`，改用 `perl`。

改打包的 MPV、MPV 配置同步、默认播放方式或 Proxy 生命周期时，读 `docs/external-runtime.md`。改访问码流程时，读 `docs/adr/0002-access-code-gateway-session.md`。

## 稳定标识

下面这些标识绑定已安装用户的数据或构建链路，保持原值，改品牌和迁移维护者时也一样。

| 标识 | 位置 | 不改的理由 |
| --- | --- | --- |
| `name`（`fntv`） | `package.json` | 决定应用名。Electron `safeStorage` 在 macOS 和 Linux 上按应用名找密钥，改名后可能解不开已保存的凭据，用户只能重新登录（`src/modules/fn_config/config.ts`）。 |
| `productName`（`飞牛影视`） | `package.json` 的 `build` | 打包后它决定应用名，风险同 `name`；安装目录和快捷方式名也随之改变。 |
| `appId`（`com.qiaokes.fntv`） | `package.json` 的 `build` | 打包工具用它生成 macOS bundle id 和 Windows 安装标识。改了会变成另一个应用，而不是升级。 |
| `~/.fntv` | `USER_DATA_PATH`（`src/public/constants.ts`） | 是 `userData` 目录，放 `config.json`、`proxy-secret` 和 Chromium 会话。改了等于丢配置，已运行的 Proxy 也认证不了。启动参数 `--user-data-dir` 能临时换掉它，只供冒烟测试隔离用户数据，不带参数时仍是 `~/.fntv`。这个开关是 Chromium 自己的，Electron 在 JS 运行前就把 `userData` 改到同一目录，Windows 冒烟测试的日志和 Chromium 数据靠这一点留在临时目录，所以不要换成应用自己的参数名。相对路径按工作目录转成绝对路径。 |
| `persist:fntv` | `src/main/common/mainwin.ts` 等，用 `git grep` 找全 | 登录 Cookie 和访问码网关 Cookie 存在这个分区。改了用户要重新登录；只改一处则读写的不是同一个会话。 |
| `third_party/fntv-mpv` | `package.json` 的 `extraFiles`、`mpvConfigHelpers.ts`、`build.yml` | 构建、打包和运行时都按这个路径找 MPV。 |
| `FNMedia_*` 产物名 | `package.json` 的 `artifactName` | `src/modules/updater/updateChecker.ts` 按这个前缀和 `_win_x64` 这类后缀匹配下载链接。 |
| 旧版解密密钥 `ENCRYPTION_KEY` | `src/modules/fn_config/config.ts` | 只用来读取旧版本加密的历史密码，读出后迁移到 `safeStorage`。改掉后这些密码解不开（`tests/credentialStorage.test.cjs`）。 |

## 进程边界

- 窗口保持 `nodeIntegration: false`、`contextIsolation: true`（`mainwin.ts`、`fnIdOauthWindow.ts`，`tests/rendererIsolation.test.cjs`）。
- 主窗口保持 `sandbox: true`，加载 esbuild 打包的 `dest/preload/bundle.js`。preload 只能 `require('electron')`，不用 `fs`、`path`、`__dirname`、`process` 和 `electron.shell`，需要这些能力时走主进程 IPC。打包用 `platform: 'browser'`，导入 Node 内置模块时构建失败（`scripts/build-preload.cjs`，`tests/preloadBundle.test.cjs`）。
- preload 插件在 `src/preload/index.ts` 里按字母序静态导入，并写进 `PLUGINS`，放进 `plugins/` 目录不会自动加载（`tests/preloadBundle.test.cjs`）。
- 本地页面只通过 `window.electronAPI` 访问主进程。这个桥只暴露给 `file:` 页面，远程页面拿不到（`src/preload/index.ts`）。
- 新增页面可用的 IPC 频道时加进 `src/preload/loginPageApi.ts` 的 `SEND_CHANNELS`、`RECEIVE_CHANNELS` 或 `INVOKE_CHANNELS`。
- IPC 处理器用 `registerHandler` 注册，不直接调 `ipcMain.on`。它捕获同步和异步错误并写日志，处理器不用自己防未捕获异常。需要告诉渲染进程失败时才写 `try`/`catch` 并回复（`src/main/handlers/core/ipcHandler.ts`，`tests/ipcHandler.test.cjs`）。
- FN ID 窗口加载远程页面。向它注入脚本、处理 bridge 消息、放行导航或采用 `Trim-MC-token` Cookie 前，都要过 `fnIdTrust.ts` 的判断。NAS 地址由 FN Connect 运行时返回，不要改成域名白名单（`tests/fnIdTrust.test.cjs`、`tests/fnIdLogin.test.cjs`）。
- `config-data` 按字段白名单发送，不含密码、访问码和 token（`src/main/handlers/plugins/auth.ts`，`tests/loginCredentials.test.cjs`）。
- 明文凭据只走按需频道发给本地登录页。这类频道的处理器用 `isLoginPage` 校验 `senderFrame`，回复带域名和账号，登录页丢弃对不上的回复（`auth.ts`，`tests/loginPageCredentials.test.cjs`）。
- 配置里的 token 不经 IPC 发给渲染进程。`Trim-MC-token` Cookie 是 `httpOnly: false`，飞牛网页前端要读取它，远程页面的脚本能读到 token，这是有意的（`src/modules/fn_config/cookie.ts`）。
- 需要用户确认或输入时走主进程的 `dialog`，或用页面内组件，浏览器原生弹窗在 Electron 里不可靠（`eslint.config.mjs` 的 `no-alert`，`tests/standards.test.cjs`）。
- 登录页的外链写成 `class="github-link"`，地址用 `https://github.com`，`<a>` 里只放文字。`openExternal` 走 `open-external` 频道，主进程用 `isLoginPage` 校验 `senderFrame`，用 `resolveAllowedExternalUrl` 只放行这个域（`src/main/handlers/plugins/externalLink.ts`，`tests/externalLink.test.cjs`）。点击处理靠 `e.target` 的 class 识别链接，放子元素后点击不到（`resource/login/index.html`、`resource/login/pageEvents.js`，`tests/accessCodeLoginPage.test.cjs`）。

## 署名

- `package.json` 显式设置 `build.copyright`，这一行同时写原作者和修改声明。不设时打包工具可能从 `author` 派生版权行，抹掉原作者。
- `README.md` 的原作者版权行 `Copyright (c) 2025 Tag mig hånden` 和 `LICENSE` 保持原样，修改声明另起一行。
- `package.json`、`README.md` 和 `resource/login/index.html` 都保留原作者名（`tests/standards.test.cjs`）。

## 网络

- 依赖 `persist:fntv` 会话 Cookie 的请求用 Electron `net`（`src/main/common/accessCodeSession.ts`）。
- FNMedia API 和更新检查走 `axios`，也就是 Node 网络栈，不走 Chromium（`src/modules/fn_api/request.ts`、`updateChecker.ts`）。
- 页面能打开但主进程请求失败时，先查这个差异：系统代理、VPN 和证书在两个网络栈里表现不同。

## 更新检查

- 更新源只在 `updateChecker.ts` 的 `UPDATE_REPOSITORY` 改。
- GitHub 返回 404 表示仓库还没有 Release，按 `hasUpdate: false` 处理，不重试，不报错。其它失败照常提示（`tests/updateChecker.test.cjs`）。
- 只重试网络错误、超时和 5xx。4xx 在几秒内不会变，重试只会多耗额度。
- 未认证的 GitHub API 每个出口 IP 每小时 60 次，代理和 VPN 节点上的用户共用。403 或 429 且额度用完时不重试，在恢复时间前不再请求 API。带 `If-None-Match` 得到 304 也扣额度，条件请求省不了次数。
- API 失败时改查 `github.com/<owner>/<repo>/releases/latest`，不跟随重定向，从 `Location` 取 tag，安装包链接按 `artifactName` 拼出（`githubRelease.ts`，`tests/updateCheckerRateLimit.test.cjs`）。
- 安装包匹配按打包工具的真实架构名写：Linux x64 的 AppImage 产物名是 `x86_64`，不是 `x64`。

## 凭据

- 落盘的凭据走 `config.ts` 的 `writeConfig`，由 `encryptCredential` 加密。新增凭据字段时，同时补上读写两边。
- 解不开的凭据读出来是空值，按未登录处理，密文留在 `config.ts` 内部由 `writeConfig` 原样写回，只有新值才替换。新增凭据字段时读写两边用 `readCredential` 和 `storeCredential`（`tests/credentialDecryptFailure.test.cjs`、`tests/credentialPreservation.test.cjs`）。
- 历史记录超过上限时先淘汰能解开的条目，解不开的留到最后，刚添加的条目不淘汰（`tests/credentialHistoryLimit.test.cjs`）。
- Linux 上 `safeStorage` 后端是 `basic_text` 时拒绝保存，不降级为明文。
- FN ID、用户名和完整 NAS 地址不进日志。`log.noformat` 同样经过脱敏，但脱敏只是兜底，写日志时不要拼这些值。
- Proxy 密钥、访问码、token 和播放 `session` 不进日志、URL、命令行参数和环境变量。例外是播放 URL 里的 `session`，它本身就是短期能力，记录时要脱敏（`src/modules/logger/masking.ts`，`tests/sessionMasking.test.cjs`）。

## 配置文件

- `config.json` 只由 `config.ts` 的 `writeConfig` 写。写入走临时文件、`fsync` 和 `rename`，中途失败时旧文件不变（`tests/configDurability.test.cjs`）。
- 解析失败或 `history` 不是数组的文件读出来会丢内容，被替换前复制为 `config.json.corrupt-<毫秒时间戳>`，保留最新 3 份，备份失败就放弃这次写入。备份含密文，日志只记文件名。`history` 不是数组时按空列表读取，只读不写时文件不变。

## 模块

- TS 源文件用 ES `export`，不写 `module.exports =`。这种写法会覆盖 `export` 的结果，新函数没加进表时运行时是 `undefined`，`tsc` 查不出（`eslint.config.mjs`）。
- 登录页脚本是按顺序加载的经典脚本，不用 `type="module"`，`file:` 下会被拦。顶层 `const`、`let` 和函数跨文件共享，给其它脚本用的名字写进文件头的 `/* exported */`；顶层语句只能用已加载脚本里的名字。会重新赋值的状态放在唯一写它的脚本里（`resource/login/index.html`，`tests/loginPageCredentials.test.cjs`）。

## 平台差异

- 只有 `src/public/platform.ts` 读取 `process.platform` 和 `process.arch`，其它文件用 `currentPlatform()`、`currentArch()`（`eslint.config.mjs` 的 `no-restricted-properties`）。维护者只有 Windows，散在各处的 macOS 和 Linux 分支在本机跑不到。
- 新的平台差异写进 `platformBehavior(platform)` 的返回值，或写成接收平台参数的纯函数（`proxyExecutablePath`、`mpvUserConfigDir`、`expectedAssetName`），调用处只读结果。路径按目标平台的 `path.win32` 或 `path.posix` 拼，测试结果与主机无关（`tests/platform.test.cjs`）。
- `currentPlatform()` 每次调用时读取，不在模块加载时缓存。已有测试靠改写 `process.platform` 模拟 Linux（`tests/helpers/credentialConfig.cjs`）。

## 跨层改动

- 改字段含义前，用 `git grep` 找全读写处，改完再搜一遍。`hideOriginalPlayButton` 同时被主进程、preload 和登录页读取，默认值必须一致（`docs/external-runtime.md`）。
- TS 和 Go 之间的契约两端一起改：
  - `PlaybackSessionInput`（`proxySession.ts`）和 `PlaybackSessionRequest`（`session.go`）的 JSON 字段。
  - `composeCookieHeader`（`accessGrant.ts`）和 `ComposeCookieHeader`（`request.go`）。
  - `/health` 的 `service`、`protocol`（`proxyHealth.ts`、`register.go`）。

## 依赖

- `pnpm-lock.yaml` 入库，改 `package.json` 的依赖时在同一个提交里更新。工作流用 `pnpm install --frozen-lockfile`，两者不一致时安装直接失败（`tests/standards.test.cjs`）。
- pnpm 版本只写在 `package.json` 的 `packageManager`，`pnpm/action-setup` 读这个字段，工作流不另写一份（`tests/standards.test.cjs`）。
- pnpm 配置写在 `pnpm-workspace.yaml`，`.npmrc` 只放 `registry`。pnpm 不读 `.npmrc` 里的 `node-linker`，也不把 `electron_mirror` 传给安装脚本；CI 还会删掉 `.npmrc`（`tests/standards.test.cjs`）。
- `nodeLinker` 保持 `hoisted`，这个布局打包出的生产依赖和迁移前一致。改依赖布局时解开产物的 `app.asar`，核对 `node_modules` 里生产依赖齐全，构建成功不算验证。
- 有安装脚本的依赖要在 `allowBuilds` 里写明，否则 `pnpm install` 报 `ERR_PNPM_IGNORED_BUILDS` 并跳过脚本。`electron` 必须放行，它的 postinstall 下载二进制（`tests/standards.test.cjs`）。
- 保留 `extract-zip>yauzl` 的 override，等 `extract-zip` 改用 `yauzl` 3 后再去掉。`yauzl` 2.10 在 Node 26 上读不出 zip 内容，进程却以 0 退出，`electron` 的 postinstall 显示成功，留下只有空 `locales` 的 `dist`。

## GitHub Workflow

- 提交信息、PR 标题、分支名这类不可信内容先放进 `env:`，再在 shell 里用 `"$VAR"` 读取。范例是 `release.yml` 的 `Select platforms` 步骤（`PLATFORM`）。
- 第三方 action 固定到 commit SHA，行尾注释版本号（`ci.yml`、`release.yml`，`tests/standards.test.cjs`）。本仓库的可复用 workflow 写成 `uses: ./.github/workflows/<文件>`，不固定 SHA。
- Go 版本用 `go-version-file: src/modules/proxy/go.mod` 读取。
- 工作流顶层权限只给 `contents: read`，需要写权限的 job 单独声明。`release.yml` 里只有 `release-please` 和 `publish` 两个 job 有写权限，构建 job 只读。
- 发版走 `release.yml`：push 到 `main` 时 release-please 维护 Release PR；建好或更新 Release PR 的那次运行对 PR 的 head 分支构建并跑冒烟测试，不发布。合并后建 draft Release，三平台构建、5 个安装包的冒烟测试全部成功，`publish` 核对安装包名并上传后才转正式。更新检查只看正式 Release，有安装包启动不了或资产不全时不能公开。GITHUB_TOKEN 创建的 Release 和 Release PR 都不触发其它 workflow，构建、冒烟测试和上传都要用 `needs` 接在同一个 workflow 里。手动触发只构建和跑冒烟测试，不发布，产物留在 Actions artifacts。冒烟测试失败后的处理见 `TESTING_STANDARDS.md` 的“发版门禁失败后”。构建步骤只在 `build.yml` 写一份，`release.yml` 和 `build-and-smoke.yml` 都调用它。
- 版本号和 `CHANGELOG.md` 由 Release PR 改，不手动改 `package.json` 的 `version` 和 `.release-please-manifest.json`。release-please 的配置在 `release-please-config.json`。
- `package.json` 里每条 `electron-builder` 打包命令都带 `--publish never`。不写时它在 CI 上按 `repository` 隐式发布到 GitHub（`tests/standards.test.cjs`）。
- 构建依赖的外部资产固定 tag 和 sha256（`build.yml` 的 `Download third-party dependencies`）。
- `ci.yml` 的 `pull_request` 不按 `branches` 过滤，堆叠 PR 的 base 不是 `main`，也要跑。
- 工作流不出现 `head_commit`、`releases/latest` 和 `secrets.`（`tests/standards.test.cjs`）。

## 文档

- 中文和英文、数字之间加一个空格，行内代码和链接的两侧也一样。中文句子用全角标点。
- 产品名用官方写法：Windows、macOS、Linux、PotPlayer、Anime4K、NAS。说播放器时写 MPV，只有命令才写 `mpv`。
- 文件名、路径和配置项放进行内代码。
- 验证：`perl -CSD -ne 'print "$.:$_" if /\p{sc=Han}[A-Za-z0-9]|[A-Za-z0-9]\p{sc=Han}/' README.md` 只剩代码块和链接锚点里的内容。

## 提交

格式是 `type(scope): 描述`，描述用中文，一个提交只做一件事。PR 标题用同样的格式。`.githooks/commit-msg` 检查提交信息，CI 的 `pr-title.yml` 只检查 PR 标题（`scripts/check-commit-message.cjs`，`tests/commitMessage.test.cjs`）。

PR 只用 squash 合并。仓库设置只允许 squash，提交标题取 PR 标题、正文留空，进入 `main` 的只有 PR 标题。用合并提交时 release-please 会把合并提交正文里的 PR 标题和 PR 里的每个提交都收录，同一改动出现两次（2026-11-07 dry run 所见，见 `docs/wiki/release-and-update.md`）。

PR 标题就是 changelog 条目，要写成用户能懂的话。release-please 把 `feat` 归入“新功能”、`fix` 归入“问题修复”、`perf` 归入“性能优化”，写进 `CHANGELOG.md` 和 Release 说明，更新提示框也显示这段文字。这三类的标题写用户看到的变化，例如 `fix(player): 剧集详情页的播放键改用 MPV 播放`，不写函数名和实现细节。只改内部实现、用户感觉不到时用 `refactor` 或 `chore`，它们不进 changelog。一个 PR 里既有用户可见的改动又有内部改动时，标题按用户可见的那部分写。合并前改标题后，CI 会重新检查。

- `type`：`feat`、`fix`、`perf`、`docs`、`refactor`、`test`、`chore`、`ci`、`build`、`style`、`revert`。不兼容的改动在 `type` 后加 `!`，会提升主版本号。
- `scope`：受影响的模块或领域，例如 `player`、`media`、`playback`、`agents`。没有明确模块时可以省略。

## 文件大小

agent 写的文件不超过 5,000 tokens（字节数 / 4）。`pnpm install` 会启用 `.githooks/`（`pre-commit` 和 `commit-msg`），`pre-commit` 只检查暂存文件，超限时按错误信息拆分。二进制文件自动跳过，锁文件和生成文件在 `.gitattributes` 里标 `-agent-authored`（`scripts/check-staged-file-size.cjs`，`tests/stagedFileSize.test.cjs`）。
