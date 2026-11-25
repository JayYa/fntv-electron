# 编码标准

改附带的 MPV 或 MPV 归档、用户配置同步、默认播放方式、Proxy 或播放会话时，读 `docs/external-runtime.md`。改访问码流程或登录页的凭据频道时，读 `docs/adr/0002-access-code-gateway-session.md`。

## 稳定标识

下面这些标识绑定已安装用户的数据、构建链路或原作者署名，保持原值，改品牌和迁移维护者时也一样。

| 标识 | 位置 | 不改的理由 |
| --- | --- | --- |
| `name`（`fntv`） | `package.json` | 决定应用名。Electron `safeStorage` 在 macOS 和 Linux 上按应用名找密钥，改名后可能解不开已保存的凭据，用户只能重新登录（`src/modules/fn_config/credentialCrypto.ts`）。 |
| `productName`（`飞牛影视`） | `package.json` 的 `build` | 打包后它决定应用名，风险同 `name`；安装目录和快捷方式名也随之改变。 |
| `appId`（`com.qiaokes.fntv`） | `package.json` 的 `build` | 打包工具用它生成 macOS bundle id 和 Windows 安装标识。改了会变成另一个应用，而不是升级。 |
| `~/.fntv` | `USER_DATA_PATH`（`src/public/constants.ts`） | 是 `userData` 目录，放 `config.json`、Chromium 会话和 `logs/`。改了等于丢配置。在 `app.setPath` 之前加载的模块用 `USER_DATA_PATH`，那时 `app.getPath('userData')` 还是 Electron 默认目录（`src/modules/logger/logger.ts`）。 |
| `persist:fntv` | `WEB_UI_SESSION_PARTITION`（`src/main/common/webUiSession.ts`） | 网页端会话的分区，登录 Cookie 和访问码网关 Cookie 存在这里。改了用户要重新登录。 |
| `third_party/fntv-mpv` | `package.json` 的 `extraFiles`、`mpvConfigHelpers.ts`、`build.yml` | 构建、打包和运行时都按这个路径找 MPV。 |
| `FNMedia_*` 产物名 | `package.json` 的 `artifactName` | `src/modules/updater/updateChecker.ts` 按这个前缀和 `_win_x64` 这类后缀匹配下载链接。 |
| 更新源 `releases/latest/download/` | `package.json` 的 `build.publish`、`src/modules/updater/updateChecker.ts` | 已发的客户端按 `https://github.com/JayYa/fntv-electron/releases/latest/download/` 找应用内更新。改地址或换仓库，已发客户端就找不到新版本，只能手动升级（`tests/releaseGate.test.cjs`）。 |
| `latest.yml`、`latest-linux.yml`、`latest-linux-arm64.yml` | electron-builder 生成，`build.yml` 核对 size 和 sha512 后上传，`release.yml` 发布前核对文件齐全 | 已发客户端里的 electron-updater 按平台和架构从更新源读这几个文件名：Windows 读 `latest.yml`，Linux x64 读 `latest-linux.yml`，Linux arm64 读 `latest-linux-arm64.yml`。Release 里缺一个或改了名，对应平台就收不到应用内更新（`tests/releaseGate.test.cjs`）。 |
| `build.copyright` | `package.json` | 同时写原作者和修改声明。不设时打包工具可能从 `author` 派生版权行，抹掉原作者。 |
| 旧版解密密钥 `ENCRYPTION_KEY` | `src/modules/fn_config/credentialCrypto.ts` | 只用来读取旧版本加密的历史密码，读出后迁移到 `safeStorage`。改掉后这些密码解不开（`tests/credentialStorage.test.cjs`）。 |

## 进程边界

- 新建窗口保持 `nodeIntegration: false`、`contextIsolation: true`（`mainwin.ts`、`fnIdLogin.ts`）。
- preload 在沙箱里运行，只能 `require('electron')`。需要 `fs`、`path`、`process` 或 `electron.shell` 时走主进程 IPC。
- 新增页面可用的 IPC 频道时加进 `src/preload/loginPageApi.ts` 的 `SEND_CHANNELS`、`RECEIVE_CHANNELS` 或 `INVOKE_CHANNELS`。
- `registerHandler` 已经捕获并记录 IPC 处理器的同步和异步错误，处理器只在需要告诉渲染进程失败时写 `try`/`catch`（`src/main/handlers/core/ipcHandler.ts`）。
- FN ID 窗口加载远程页面。向它注入脚本、处理 bridge 消息、放行导航或采用 `Trim-MC-token` Cookie 前，都要过 `fnIdTrust.ts` 的判断。信任按 FN Connect 运行时返回的 NAS 地址判断，不按域名白名单（`tests/fnIdTrust.test.cjs`）。
- 依赖网页端会话 Cookie 的请求用 Electron `net`（`src/main/common/accessCodeSession.ts`）。

## 凭据和配置

- `config.json` 只由 `src/modules/fn_config/` 下两个 module 写（落盘和损坏备份在 `configFile.ts`）：当前登录和登录历史归 `loginStore.ts`，只在其中的 `commit` 写盘（改动走 `transaction`，读取当前登录时的旧格式迁移也调它）；设置项归 `settings.ts`（不解密，凭据磁盘值原样写回，只顺带去掉登录历史里不能用的条目）。新增凭据字段时只在 `loginStore.ts` 的 `LOGIN_CREDENTIALS` 或 `HISTORY_CREDENTIALS` 登记。
- 要明文凭据的导出函数是异步的（`safeStorage` 只有异步接口可用），按调用顺序排队执行；加解密都在读改写之前做完，读改写本身同步完成。
- FN ID、用户名和完整 NAS 地址不进日志。日志脱敏只是兜底。
- 访问码、token 和播放 `session` 不进日志、URL、命令行参数和环境变量。例外是播放 URL 里的 `session`，它本身就是短期能力，记录时脱敏（`src/modules/logger/masking.ts`）。

## 模块

- `src/modules/fn_api/core/` 和 `src/modules/proxy_service/` 不加载 `electron`：访问授权 Cookie、证书信任和日志由调用方通过 `RequestContext` 或参数传入。
- 登录页脚本是按顺序加载的经典脚本，不用 `type="module"`，`file:` 下会被拦。顶层 `const`、`let` 和函数跨文件共享，给其它脚本用的名字写进文件头的 `/* exported */`；顶层语句只能用已加载脚本里的名字。会重新赋值的状态放在唯一写它的脚本里（`resource/login/index.html`）。
- 新的平台差异写进 `src/public/platform/` 下对应平台的文件（`win32.ts`、`darwin.ts`、`linux.ts`，macOS 和 Linux 共用的逻辑放 `posix.ts`）：给 `PlatformImpl` 加字段，由 `index.ts` 查表选取，调用处只读结果（ADR-0006）。src 里不和 `'win32'`、`'darwin'`、`'linux'` 比较或 `case` 它们，也不比较 `currentPlatform()`、`currentArch()`，lint 拦截。路径按目标平台的 `path.win32` 或 `path.posix` 拼，测试结果与主机无关。

## 跨层改动

- 改字段含义前，用 `git grep` 找全读写处，改完再搜一遍。`hideOriginalPlayButton` 同时被主进程、preload 和登录页读取，默认值必须一致（`docs/external-runtime.md`）。

## 依赖

- 改依赖布局（如 `nodeLinker`）时解开产物的 `app.asar`，核对 `node_modules` 里生产依赖齐全，构建成功不算验证。
- `node-mpv-2` 带一个 `pnpm patch` 补丁（`patches/`）：给 socket 消息加按行缓冲；`start()` 完成前 MPV 退出或出错时让 `start()` reject；`start()` 完成后子进程的 `error` 监听不再抛 `TypeError`（ADR-0016）。补丁按版本号绑定，换版本时先确认新版本是否已修，没修就在新版本上重做补丁。

## Markdown 文档

- 产品名用官方写法：Windows、macOS、Linux、PotPlayer、Anime4K、NAS。说播放器时写 MPV，只有命令才写 `mpv`。
- 文件名、路径和配置项放进行内代码。
