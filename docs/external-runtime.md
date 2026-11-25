# 外部运行时归属

决策原因见 [ADR-0001](adr/0001-mpv-bundle-and-runtime-ownership.md)、[ADR-0005](adr/0005-mpv-archive-manifest-sync.md) 和 [ADR-0004](adr/0004-proxy-in-typescript-utility-process.md)。MPV 归档要遵守的约定（客户端依赖的路径、清单格式、`mpv.conf` 分层、能力）见 [MPV 归档契约](mpv-archive-contract.md)；术语见 [GLOSSARY.md](../GLOSSARY.md)。

## 用户配置在哪

便携配置由 `resolvePortableConfigDir` 定位。用户配置按 mpv 自己的查找规则定（`mpvUserConfigDir`，`src/public/platform/`）：

- 设了 `MPV_HOME` 就是它。
- 否则 Windows 是 `app.getPath('appData')` 下的 `mpv`（通常是 `%APPDATA%mpv`），其它平台是 `$XDG_CONFIG_HOME/mpv`，未设或不是绝对路径时 `~/.config/mpv`。Windows 上用打包的 mpv 时，`media.ts` 用 `--config-dir` 把同一个目录传给 mpv。
- Windows 上用户自己指定的 `mpv.exe` 旁边有 `portable_config` 时，mpv 只读那里，同步也写那里（`MPV_HOME` 仍优先，#114）；指定的是 scoop 的 shim 时，按旁边 `.shim` 文件里的 `path` 找到真实 `mpv.exe`，用它旁边的 `portable_config`（#262，格式见 [ADR-0011](adr/0011-platform-behavior-facts.md)）；其它包管理器的 shim 不处理。
- macOS 和 Linux 上标准目录不存在而 `~/.mpv` 存在时，同步写 `~/.mpv`，不新建标准目录（#115）。

同步只在客户端启动时进行，改了 MPV 播放器路径后要重启客户端才同步到新目录。

## 运行哪个 MPV

入口是 `mpvProgram`（`src/public/platform/`），它同时说明是不是附带 MPV（决定是否传 `--config-dir`），托盘显示和播放都用它，两处看到的是同一个 MPV。

- 有自选 MPV（托盘里设置的路径）时用它，不检查文件是否存在。
- Windows 上没有自选 MPV 时用附带 MPV `third_party/fntv-mpv/mpv.exe`，同样不检查。
- macOS 依次检查 `/opt/homebrew/bin/mpv`、`/usr/local/bin/mpv`、`/Applications/mpv.app/Contents/MacOS/mpv`；Linux 依次检查 `/usr/bin/mpv`、`/usr/local/bin/mpv`、`/snap/bin/mpv`、`/usr/games/mpv`、`/opt/mpv/bin/mpv`。都不存在时，托盘显示“未找到”，播放时才弹错误框。不读 `PATH`。

托盘“设置”子菜单：

- `设置 MPV 播放器路径 (<路径>)` 总是显示上面算出的路径，找不到时显示 `(未找到)`。
- `打开 MPV 用户配置目录 (<路径>)` 显示按当前设置算出的用户配置目录，也就是下次播放时 MPV 读的目录。目录不存在时只弹提示，不创建：空目录会让下次同步按首次初始化处理。`shell.openPath` 失败时弹错误框并记 ERROR 日志。
- `MPV 配置有 N 个待合并的更新` 只在上面这个目录里有 `*.fntv-new`（不算 `.fntv-sync-*` 里的）时显示，点击打开目录。托盘递归监视这个目录（`src/main/common/mpvConfigSync/pendingUpdates.ts`），`.fntv-new` 增删后约 200 毫秒重建菜单，删完这一项就消失。开始监视后约 200 毫秒还会再重建一次，补上监视生效前发生的增删。

## MPV 归档

- MPV 和插件的版本只在 `fntv-mpv-config/package_cfg.json` 固定。
- Electron 构建只下载这一个归档，不从上游插件分支覆盖文件（`.github/workflows/build.yml` 的 `Download third-party dependencies`）。这一条没有自动化测试，改工作流时用 `grep -n -i danmaku .github/workflows/build.yml .github/workflows/release.yml` 确认没有结果。
- 当前固定 `JayYa/fntv-mpv-config` 的 tag `fntv-mpv-v20261121_193330`。这个 Release 由 `JayYa/fntv-mpv-config` 自己的 `release` 分支构建，上游 `QiaoKes/fntv-mpv-config` 没有这个 tag。
- tag、资产名和 sha256 只写在仓库根目录的 `mpv-archive.json`，不写进 `.github/workflows`：`GITHUB_TOKEN` 推不了改 workflow 的提交，自动升级的 PR 会被拒。下载、校验和缓存的约定写在 `build.yml` 的注释里，由 `tests/mpvArchiveCache.test.cjs` 检查。
- 升级归档：先在 `JayYa/fntv-mpv-config` 发布新 Release。`update-mpv-archive.yml` 每天查一次它的最新正式 Release，tag 比固定的新时开 PR（分支 `automation/mpv-archive`，标题 `fix: 附带的 MPV 和插件更新到 <tag>`）；不想等就在 Actions 里手动触发，可填 tag 换成指定的 Release（也用于回滚）。这个 PR 由 `GITHUB_TOKEN` 开，检查显示 action_required，维护者在 PR 上点 “Approve workflows to run” 后 CI 和 Smoke Test 才跑。
- 手工升级也运行 `node scripts/update-mpv-archive.cjs`（或加 `--tag <tag>`），不手改：要改哪几处由它决定（用法见脚本开头），包括本页上面那条 tag。
- `build.yml` 在编译之后、打包之前运行 `Check MPV archive manifest`（`scripts/check-mpv-manifest.cjs`）：清单读不出、`formatVersion` 不认识、`archiveVersion` 不是 `mpv-archive.json` 固定的 tag，或 `provides` 不满足 `MPV_REQUIRED_CAPABILITIES` 时构建失败。`pnpm run check` 不下载归档，只用临时夹具测这个脚本（`tests/mpvArchiveManifest.test.cjs`）；升级归档的 PR 改了 `mpv-archive.json`，会触发 Smoke Test 构建，在真实归档上跑它。
- Windows 打包整个 `third_party/fntv-mpv`，含 `mpv.exe` 和清单。macOS 和 Linux 只打包 `portable_config` 和清单 `fntv-manifest.json`（`package.json` 的 `extraFiles`，两处），清单仍在便携配置的上一级，`resolveManifestPath` 找得到。三个平台都带清单由 `tests/standards.test.cjs` 检查，安装包冒烟测试检查启动日志里有“MPV 配置已按清单 <tag> 同步”。

## 用户配置同步

入口是 `synchronizeMpvConfig`（`src/main/common/mpvConfigSync/sync.ts`），按 MPV 归档根目录的清单 `fntv-manifest.json`（`resolveManifestPath`，便携配置的上一级）同步。客户端认识的清单格式版本是 `SUPPORTED_MANIFEST_FORMAT_VERSIONS`（`manifest.ts`）。返回结构化结果，`mpvRuntime.ts` 用 `mpvConfigSyncLogLines`（`log.ts`）按文件写日志，未变的文件只计数。

整体跳过时什么都不改，也不写安装记录：

| 情况 | 结果 | 日志 |
| --- | --- | --- |
| 用户配置就是便携配置（按 realpath 比较，例如自选 mpv 就是附带的 mpv，#118）。用户改的是安装目录里的文件，下次安装包升级整个覆盖，没有 `.fntv-new` 也没有提示 | `skipped`，`same-directory` | WARN |
| 清单缺失 | `skipped`，`manifest-missing` | ERROR |
| `formatVersion` 不在支持的集合里 | `skipped`，`manifest-unsupported` | ERROR |
| 清单不是合法 JSON、字段形状不对、路径不是便携配置内的相对路径 | `skipped`，`manifest-invalid` | ERROR |

安装记录是用户配置下的 `fntv/installed.json`：归档版本、每个文件装入的哈希和归属、`provides`、已确认的冲突。只在同步全部完成后写。判断“用户没改过”按单个文件：记录里有这个文件时看当前哈希是否等于记录值，没有时看是否在该文件的 `knownHashes` 里。

每个文件依次判断，先命中的生效：

| 情况 | 动作（`files[].action`） |
| --- | --- |
| 当前内容已等于新版 | `unchanged`，不动。重跑幂等靠这一条 |
| 文件缺失（任何归属） | `added` |
| `seed`（`danmaku-history.json`）已存在 | `kept` |
| 没改过 | `replaced` |
| `managed`，改过 | `overwrote-modified`，照样覆盖，不备份，记 INFO |
| `config`，改过，新版等于记录值（上次装入后归档没改它） | `kept`；上次写的 `.fntv-new` 还在（内容等于新版）时仍进 `conflicts` |
| `config` 是 `mpv.conf`，改过，没有它的记录，平台是 macOS 或 Linux（`platformBehavior().treatsUnknownMpvConfAsUserOwned`） | `kept`，不写 `.fntv-new`、不算冲突，也不记录，下次仍按这一条判断，永远不提示合并（#219）。这些平台上的用户配置是用户日常用的 mpv 目录，`mpv.conf` 可能是用户自己写的 |
| `config`，改过 | `wrote-fntv-new`：原文件不动，新版写到 `<文件>.fntv-new`（已有旧的就替换），进 `conflicts`（路径加新版哈希） |

- `managedDirs` 整目录替换：目录里有文件要变时，在暂存目录复制出完整的新目录，带上旧目录里清单没列出的文件（用户自己放进去的文件），再 rename 换掉，失败时放回旧目录。uosc_danmaku 的 `check-update` 自更新改写的插件目录，下次启动被改回归档里的版本。
- 记录里有、新清单没有的文件（以及清单 `obsolete` 列出的文件）：哈希等于记录值才删（`removed`）；没有记录时按 `obsolete` 的 `knownHashes` 判断；改过的保留（`kept`）。记录里归属是 `config` 的一律保留。不在记录也不在 `obsolete` 里的文件不碰，例如 smart_skip 运行时写的 `script-opts/smart_skip.conf`。
- 所有新内容（含 `.fntv-new` 和安装记录）先写进用户配置根目录的 `.fntv-sync-*`，校验哈希、fsync，再 rename 到位。暂存目录放在根目录，mpv 不会把它当脚本加载。哈希不符说明便携配置和清单不一致，同步失败。
- 每次启动在读清单之前清理残留的 `.fntv-sync-*`，清单缺失或版本不认识也照样清理；用户配置就是便携配置（`same-directory`）时不碰。上次停在“旧目录已移开、新目录还没到位”时（目录替换前写了 `target.json`），先把旧目录放回去，再正常同步。
- 同步失败（`failed`）：已到位的文件保留，不写新记录，记 ERROR，不阻塞启动；下次启动重跑，已到位的文件命中 `unchanged`，结果和一次跑完相同。
- 不要改回先删目标再复制：目标和来源是同一目录时，这样会把附带的插件删光（#118）。

### 待合并更新的提示

`mergePrompt`（`mergePrompt.ts`）从同步结果的 `conflicts` 里去掉安装记录 `acknowledgedConflicts` 中路径和新版哈希都相同的项，剩下的不为空就由 `mpvRuntime`（`src/main/common/mpvRuntime.ts`）弹一次非模态对话框（不挂在主窗口上，不等它关闭），列出 `.fntv-new`，按钮“打开配置目录”“知道了”。任何方式关闭都调 `acknowledgeConflicts`（`installRecord.ts`）把这批冲突写进安装记录，同一路径的旧确认被替换；没关就退出，下次同步因为 `.fntv-new` 还在照样报这条冲突，再弹。新归档给同一文件写了不同的 `.fntv-new` 时哈希变了，算新冲突。同步前没有安装记录（`hadInstallRecord` 为 `false`）时用一次性迁移的文案。

### 能力检查

同步之后 `mpvRuntime.ts` 调 `checkMpvCapabilities`（`src/main/common/mpvConfigSync/capabilities.ts`），把用户配置里实际装上的 `provides` 和客户端的 `requires`（同一文件的 `MPV_REQUIRED_CAPABILITIES`，构建期断言也用 `unmetCapabilities` 和 `describeUnmetCapability`）比较：

- 平时读用户配置的安装记录。本次同步失败时旧记录仍有效；没有记录（同步从没成功过）一律不满足。
- 同步结果是 `same-directory` 时没有安装记录，读归档清单；清单读不到也算不满足。
- 不满足时记 ERROR，列出每个缺的能力、要求的版本和当前版本；托盘“设置”子菜单末尾显示一条不可点的状态（`tray.ts` 读 `mpvRuntime.capabilitiesSatisfied()`），不阻塞启动。只在启动时检查一次。

## 默认播放方式

MPV 接管默认开启。配置字段沿用旧名 `hideOriginalPlayButton`，只有 `src/modules/fn_config/preferences.ts` 读它，其它地方拿到的都是它给出的布尔值 `mpvPlayback`：

| `hideOriginalPlayButton` | 结果 |
| --- | --- |
| `true` | MPV |
| 缺失（`undefined`） | MPV |
| `false` | 网页端自带播放器 |
| `null`、字符串、数字、对象 | 网页端自带播放器 |

这几处必须同时保持这个默认值：

- `src/modules/fn_config/preferences.ts` 读写配置。
- `src/main/handlers/plugins/config.ts` 经 `get-mpv-playback` 回布尔值；`set-mpv-playback` 只收布尔值，别的值返回失败、不写入。
- `src/preload/core/takeover.ts` 读这个布尔值，2 秒内没收到回复时回退为 `true`。
- `resource/login/index.html` 的开关默认勾选，`resource/login/settings.js` 只有明确收到 `false` 才取消。

## Proxy

Proxy 是 TypeScript 写的（`src/modules/proxy_service/`），客户端启动时用 Electron `utilityProcess.fork()` 在子进程里运行，入口是 `src/modules/proxy_service/child.ts`，主进程这一侧在 `src/main/common/proxy.ts`。

- 只监听 `127.0.0.1`，端口由系统分配（监听端口 0），每次启动都可能不同。Proxy 就绪时把实际端口报给主进程，主进程写一行“Proxy 已就绪，端口 N”到 `app.log`，播放地址用这个端口拼。MPV 归档里 `smart_skip` 插件的 `api.lua` 从播放地址取 scheme、主机和端口去请求 `skipinfo`（#167）。
- HTTP 只给 MPV 用：`GET /api/v1/playvideo/:itemGuid`、`GET /api/v1/skipinfo/:itemGuid`、`POST /api/v1/skipinfo`。视频流量只在 Proxy 子进程和 MPV 之间，不经过主进程。
- 主进程和 Proxy 之间的控制走 `parentPort` IPC（消息定义在 `src/modules/proxy_service/control.ts`）：Proxy 监听成功后回报就绪，监听失败时回报错误码；主进程经 IPC 创建播放会话。没有 HTTP 控制接口，也没有密钥。
- Proxy 的日志经 IPC 交给主进程，写进 `app.log`，每行带 `[Proxy]`。

| 情况 | 行为 |
| --- | --- |
| 启动后 10 秒内没有回报就绪，或就绪前退出 | 弹窗说明，退出应用 |
| 就绪前请求播放 | 创建播放会话直接失败（“Proxy 未运行”），不等待；崩溃后重启期间也一样 |
| 运行中意外退出 | 隔 3 秒重启，最多 5 次，仍然失败就弹窗并退出应用；重启后连续运行 60 秒，次数清零 |
| 客户端退出 | 先停止播放、等退出的进度回传（最多 5 秒），再结束 Proxy 子进程并等它退出（`src/modules/quit/quitCoordinator.ts`）；「立即重启安装」引发的退出不等。客户端崩溃时 Electron 也会结束它，不留下占端口的进程 |
| `userData` 下有旧版留下的 `proxy-secret` | 启动时删除（`src/main/common/legacyProxySecret.ts`） |

## 播放会话

- 播放地址只带 `session`，不带登录 token（`createProxyPlaybackUrl`，`src/main/common/proxySession.ts`）。格式是 `http://127.0.0.1:<port>/api/v1/playvideo/<itemGuid>?session=<session>[&sourceIndex=<n>]`。会话只在创建它的那个 Proxy 子进程里有效，所以 `createPlaybackSession` 把会话 ID 和该进程的端口一起返回。
- 入参 `PlaybackSessionInput` 只定义一次（`src/modules/proxy_service/playbackSessions.ts`），主进程经 IPC 原样传入。
- `session` 是 64 位十六进制，有效期 24 小时，每次访问顺延。
- 每个会话只允许访问创建时列出的 `itemGuids`。
- `session` 等同于访问能力，所以 Proxy 不输出访问日志，Electron 日志会脱敏（`tests/sessionMasking.test.cjs`）。
