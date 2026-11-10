# 编码标准

改打包的 MPV、MPV 配置同步、默认播放方式或 Proxy 生命周期时，读 `docs/external-runtime.md`。改访问码流程或登录页的凭据频道时，读 `docs/adr/0002-access-code-gateway-session.md`。

## 稳定标识

下面这些标识绑定已安装用户的数据、构建链路或原作者署名，保持原值，改品牌和迁移维护者时也一样。

| 标识 | 位置 | 不改的理由 |
| --- | --- | --- |
| `name`（`fntv`） | `package.json` | 决定应用名。Electron `safeStorage` 在 macOS 和 Linux 上按应用名找密钥，改名后可能解不开已保存的凭据，用户只能重新登录（`src/modules/fn_config/config.ts`）。 |
| `productName`（`飞牛影视`） | `package.json` 的 `build` | 打包后它决定应用名，风险同 `name`；安装目录和快捷方式名也随之改变。 |
| `appId`（`com.qiaokes.fntv`） | `package.json` 的 `build` | 打包工具用它生成 macOS bundle id 和 Windows 安装标识。改了会变成另一个应用，而不是升级。 |
| `~/.fntv` | `USER_DATA_PATH`（`src/public/constants.ts`） | 是 `userData` 目录，放 `config.json`、`proxy-secret`、Chromium 会话和 `logs/`。改了等于丢配置，已运行的 Proxy 也认证不了。在 `app.setPath` 之前加载的模块用 `USER_DATA_PATH`，那时 `app.getPath('userData')` 还是 Electron 默认目录（`src/modules/logger/logger.ts`）。 |
| `persist:fntv` | `src/main/common/mainwin.ts` 等，用 `git grep` 找全 | 登录 Cookie 和访问码网关 Cookie 存在这个分区。改了用户要重新登录；只改一处则读写的不是同一个会话。 |
| `third_party/fntv-mpv` | `package.json` 的 `extraFiles`、`mpvConfigHelpers.ts`、`build.yml` | 构建、打包和运行时都按这个路径找 MPV。 |
| `FNMedia_*` 产物名 | `package.json` 的 `artifactName` | `src/modules/updater/updateChecker.ts` 按这个前缀和 `_win_x64` 这类后缀匹配下载链接。 |
| `build.copyright` | `package.json` | 同时写原作者和修改声明。不设时打包工具可能从 `author` 派生版权行，抹掉原作者。 |
| 旧版解密密钥 `ENCRYPTION_KEY` | `src/modules/fn_config/config.ts` | 只用来读取旧版本加密的历史密码，读出后迁移到 `safeStorage`。改掉后这些密码解不开（`tests/credentialStorage.test.cjs`）。 |

## 进程边界

- 新建窗口保持 `nodeIntegration: false`、`contextIsolation: true`（`mainwin.ts`、`fnIdOauthWindow.ts`）。
- preload 在沙箱里运行，只能 `require('electron')`。需要 `fs`、`path`、`process` 或 `electron.shell` 时走主进程 IPC。
- 新增页面可用的 IPC 频道时加进 `src/preload/loginPageApi.ts` 的 `SEND_CHANNELS`、`RECEIVE_CHANNELS` 或 `INVOKE_CHANNELS`。
- IPC 处理器用 `registerHandler` 注册。它已经捕获并记录同步和异步错误，处理器只在需要告诉渲染进程失败时写 `try`/`catch`（`src/main/handlers/core/ipcHandler.ts`）。
- FN ID 窗口加载远程页面。向它注入脚本、处理 bridge 消息、放行导航或采用 `Trim-MC-token` Cookie 前，都要过 `fnIdTrust.ts` 的判断。信任按 FN Connect 运行时返回的 NAS 地址判断，不按域名白名单（`tests/fnIdTrust.test.cjs`）。
- 依赖 `persist:fntv` 会话 Cookie 的请求用 Electron `net`（`src/main/common/accessCodeSession.ts`）。

## 凭据和配置

- `config.json` 只由 `config.ts` 的 `writeConfig` 写。新增凭据字段时读写两边用 `readCredential` 和 `storeCredential`，解不开的原值才会原样写回。
- FN ID、用户名和完整 NAS 地址不进日志。`log.noformat` 也会脱敏，但那只是兜底。
- Proxy 密钥、访问码、token 和播放 `session` 不进日志、URL、命令行参数和环境变量。例外是播放 URL 里的 `session`，它本身就是短期能力，记录时脱敏（`src/modules/logger/masking.ts`）。

## 模块

- `src/modules/fn_api/core/` 由主进程和 Proxy 共用，不引用 `electron`，也不引用 `logger` 这类会加载 `electron` 的模块。访问授权 Cookie、证书信任和日志由调用方通过 `RequestContext` 传入（`tests/fnApiCore.test.cjs`）。
- 登录页脚本是按顺序加载的经典脚本，不用 `type="module"`，`file:` 下会被拦。顶层 `const`、`let` 和函数跨文件共享，给其它脚本用的名字写进文件头的 `/* exported */`；顶层语句只能用已加载脚本里的名字。会重新赋值的状态放在唯一写它的脚本里（`resource/login/index.html`）。
- 新的平台差异写进 `platformBehavior(platform)` 的返回值，或写成接收平台参数的纯函数（`proxyExecutablePath`、`mpvUserConfigDir`、`expectedAssetName`），调用处只读结果。路径按目标平台的 `path.win32` 或 `path.posix` 拼，测试结果与主机无关（`src/public/platform.ts`）。

## 跨层改动

- 改字段含义前，用 `git grep` 找全读写处，改完再搜一遍。`hideOriginalPlayButton` 同时被主进程、preload 和登录页读取，默认值必须一致（`docs/external-runtime.md`）。
- TS 和 Go 之间的契约两端一起改：
  - `PlaybackSessionInput`（`proxySession.ts`）和 `PlaybackSessionRequest`（`session.go`）的 JSON 字段。
  - `composeCookieHeader`（`fn_api/core/cookie.ts`）和 `ComposeCookieHeader`（`request.go`）。
  - `/health` 的 `service`、`protocol`（`proxyHealth.ts`、`register.go`）。

## 依赖

- `nodeLinker` 保持 `hoisted`，这个布局打包出的生产依赖和迁移前一致。改依赖布局时解开产物的 `app.asar`，核对 `node_modules` 里生产依赖齐全，构建成功不算验证。
- `node-mpv-2` 带一个 `pnpm patch` 补丁（`patches/`），只给 socket 消息加按行缓冲。补丁按版本号绑定，换版本时先确认新版本是否已修，没修就在新版本上重做补丁（`docs/wiki/mpv-ipc.md`）。

## GitHub Workflow

- 提交信息、PR 标题、分支名这类不可信内容先放进 `env:`，再在 shell 里用 `"$VAR"` 读取。范例是 `release.yml` 的 `Select platforms` 步骤（`PLATFORM`）。
- `ci.yml` 的 `pull_request` 不按 `branches` 过滤，堆叠 PR 的 base 不是 `main`，也要跑。

## 文档

- 中文和英文、数字之间加一个空格，行内代码和链接的两侧也一样。中文句子用全角标点。
- 产品名用官方写法：Windows、macOS、Linux、PotPlayer、Anime4K、NAS。说播放器时写 MPV，只有命令才写 `mpv`。
- 文件名、路径和配置项放进行内代码。
- 验证：`perl -CSD -ne 'print "$.:$_" if /\p{sc=Han}[A-Za-z0-9]|[A-Za-z0-9]\p{sc=Han}/' README.md` 只剩代码块和链接锚点里的内容。
