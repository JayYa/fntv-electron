# 外部运行时归属

改打包的 MPV、MPV 插件、用户 MPV 配置同步、默认播放方式或 Proxy 生命周期时读这份文档。MPV 归档和用户配置同步之间的约定见 [MPV 归档契约](mpv-archive-contract.md)。决策原因见 [ADR-0001](adr/0001-mpv-bundle-and-runtime-ownership.md)、[ADR-0005](adr/0005-mpv-archive-manifest-sync.md) 和 [ADR-0004](adr/0004-proxy-in-typescript-utility-process.md)。

## 术语

- **MPV 归档**：`fntv-mpv-config` 发布的完整 zip，解压到 `third_party/fntv-mpv`。
- **便携配置**：归档里的 `portable_config`，是同步的来源，由 `resolvePortableConfigDir` 定位。
- **用户配置**：同步的目标，按 mpv 自己的查找规则定（`mpvUserConfigDir`，`src/public/platform.ts`）：设了 `MPV_HOME` 就是它；否则 Windows 是 `app.getPath('appData')` 下的 `mpv`（通常是 `%APPDATA%mpv`），其它平台是 `$XDG_CONFIG_HOME/mpv`，未设或不是绝对路径时 `~/.config/mpv`。Windows 上用打包的 mpv 时，`media.ts` 用 `--config-dir` 把同一个目录传给 mpv。Windows 上用户自己指定的 `mpv.exe` 旁边有 `portable_config` 时，mpv 只读那里，同步也写那里（`MPV_HOME` 仍优先，#114）；指定的是 scoop 之类的 shim 时找不到真实 `mpv.exe` 旁边的目录，不处理。macOS 和 Linux 上标准目录不存在而 `~/.mpv` 存在时，同步写 `~/.mpv`，不新建标准目录（#115）。同步只在客户端启动时进行，改了 MPV 播放器路径后要重启客户端才同步到新目录。

## 运行哪个 MPV

入口是 `mpvPlayer`（`src/public/platform.ts`），它同时说明是不是附带 MPV（决定是否传 `--config-dir`），托盘显示和播放都用它，两处看到的是同一个 MPV。

- 有自选 MPV（托盘里设置的路径）时用它，不检查文件是否存在。
- Windows 上没有自选 MPV 时用附带 MPV `third_party/fntv-mpv/mpv.exe`，同样不检查。
- macOS 依次检查 `/opt/homebrew/bin/mpv`、`/usr/local/bin/mpv`、`/Applications/mpv.app/Contents/MacOS/mpv`；Linux 依次检查 `/usr/bin/mpv`、`/usr/local/bin/mpv`、`/snap/bin/mpv`、`/usr/games/mpv`、`/opt/mpv/bin/mpv`。都不存在时，托盘显示“未找到”，播放时才弹错误框。不读 `PATH`。

托盘“设置”子菜单：

- `设置MPV播放器路径 (<路径>)` 总是显示上面算出的路径，找不到时显示 `(未找到)`。
- `打开MPV用户配置目录 (<路径>)` 显示按当前设置算出的用户配置目录，也就是下次播放时 MPV 读的目录。改了 MPV 播放器路径后它立刻变化，但要重启客户端才会同步到新目录。目录不存在时只弹提示，不创建：空目录会让下次同步按首次初始化处理。`shell.openPath` 失败时弹错误框并记 ERROR 日志。

## MPV 归档

- MPV 和插件的版本只在 `fntv-mpv-config/package_cfg.json` 固定。
- Electron 构建只下载这一个归档，不再从上游插件分支覆盖文件。下载逻辑在 `.github/workflows/build.yml` 的 `Download third-party dependencies` 步骤。
- 该步骤固定下载 `JayYa/fntv-mpv-config` 的 tag `fntv-mpv-v20261110_224319`，并校验 sha256。这个 Release 由 `JayYa/fntv-mpv-config` 自己的 `release` 分支构建，上游 `QiaoKes/fntv-mpv-config` 没有这个 tag。
- tag、资产名和 sha256 写在仓库根目录的 `mpv-archive.json`，`build.yml` 的 `Read pinned MPV archive` 步骤把它转成 `MPV_CONFIG_*` 环境变量并校验格式。不写在 `build.yml` 里：`GITHUB_TOKEN` 推不了改 `.github/workflows` 的提交，自动升级的 PR 会被拒（2026-11-14 第一次运行就是这样失败的）。压缩包缓存在 `$RUNNER_TEMP/mpv-archive`，key 含 sha256，换版本时自动失效。缓存用 `actions/cache/restore` 和 `actions/cache/save` 分开写，下载并校验通过后立即保存，后面的构建失败也不丢；命中时不保存，缓存出错不让构建失败。命中缓存也校验 sha256，不通过就重新下载。以上缓存约定由 `tests/mpvArchiveCache.test.cjs` 检查。未命中时 `curl` 对所有错误重试 5 次，每次隔 10 秒，最多 5 分钟，避免 Release 下载偶发的 5xx 让构建失败。
- electron-builder 打包时下载的另一个架构的 Electron zip 和打包工具不缓存（2026-11-14 删掉，不命中只多 10 到 14 秒），下载出 5xx 或网络错误时 `Build application` 整体重跑，共 3 次。宿主架构的 Electron zip 由 `install-dependencies` 的 `electron-<os>-<arch>-<版本>` 缓存恢复，存在 `@electron/get` 的默认目录（Linux `~/.cache/electron`，macOS `~/Library/Caches/electron`，Windows `%LOCALAPPDATA%\electron\Cache`），它不读 `ELECTRON_CACHE`。
- 升级归档：先在 `JayYa/fntv-mpv-config` 发布新 Release。`update-mpv-archive.yml` 每天查一次它的最新正式 Release，tag 比 `mpv-archive.json` 固定的新时开 PR（分支 `automation/mpv-archive`，标题 `fix(deps): 附带的 MPV 和插件更新到 <tag>`）；不想等就在 Actions 里手动触发它，可填 tag 换成指定的 Release（也用于回滚）。这个 PR 由 `GITHUB_TOKEN` 开，检查显示 action_required，维护者在 PR 上点 “Approve workflows to run” 后 CI 和 Smoke Test 才跑。
- 改哪几处只由 `scripts/update-mpv-archive.cjs` 决定，手工升级也运行它：`node scripts/update-mpv-archive.cjs`（最新 Release，比固定的新才改）或 `node scripts/update-mpv-archive.cjs --tag <tag>`，设了 `GH_TOKEN` 时带上它调 API。它从 Release API 取资产名（不按 tag 推算）和资产的 sha256 digest，不下载归档，改 `mpv-archive.json` 里的 tag、资产名和 sha256，`README.md` 准备步骤里的 tag 和资产名，以及本页上面那条 tag。Release 必须恰好有一个 `.zip` 资产且有 digest，否则报错、什么都不改。三处不一致时 `tests/mpvArchiveCache.test.cjs` 失败，脚本和 workflow 由 `tests/mpvArchiveUpdate.test.cjs` 检查。
- Windows 打包整个 `third_party/fntv-mpv`，含 `mpv.exe`。macOS 和 Linux 只打包 `portable_config`（`package.json` 的 `extraFiles`）。

## 用户配置同步

同步规则、清单格式、归档里客户端依赖的路径和改归档时的检查项见 [MPV 归档契约](mpv-archive-contract.md)，决策见 [ADR-0005](adr/0005-mpv-archive-manifest-sync.md)。按清单同步已落地（#222）；打包带清单（#221）、待合并更新的提示（#223）和启动时的 `provides` 检查（#224）尚未生效。下面是当前代码的行为。

入口是 `synchronizeMpvConfig`（`src/main/common/mpvConfigSync/sync.ts`），按 MPV 归档根目录的清单 `fntv-manifest.json`（`resolveManifestPath`，便携配置的上一级）同步。客户端认识的清单格式版本是 `SUPPORTED_MANIFEST_FORMAT_VERSIONS`（`manifest.ts`）。返回结构化结果，`mpvConfig.ts` 用 `mpvConfigSyncLogLines`（`log.ts`）按文件写日志，未变的文件只计数。

整体跳过时什么都不改，也不写安装记录：

| 情况 | 结果 | 日志 |
| --- | --- | --- |
| 用户配置就是便携配置（按 realpath 比较，例如自选 mpv 就是附带的 mpv，#118） | `skipped`，`same-directory` | WARN |
| 清单缺失 | `skipped`，`manifest-missing` | ERROR |
| `formatVersion` 不在支持的集合里 | `skipped`，`manifest-unsupported` | ERROR |
| 清单不是合法 JSON、字段形状不对、路径不是便携配置内的相对路径 | `skipped`，`manifest-invalid` | ERROR |

安装记录是用户配置下的 `fntv/installed.json`：归档版本、每个文件装入的哈希和归属、`provides`、已确认的冲突。只在同步全部完成后写。判断“用户没改过”：有记录时看当前哈希是否等于记录值，没有记录时看是否在该文件的 `knownHashes` 里。

每个文件依次判断，先命中的生效：

| 情况 | 动作（`files[].action`） |
| --- | --- |
| 当前内容已等于新版 | `unchanged`，不动。重跑幂等靠这一条 |
| 文件缺失（任何归属） | `added` |
| `seed`（`danmaku-history.json`）已存在 | `kept` |
| 没改过 | `replaced` |
| `managed`，改过 | `overwrote-modified`，照样覆盖，不备份，记 INFO |
| `config`，改过，新版等于记录值（上次装入后归档没改它） | `kept` |
| `config` 是 `mpv.conf`，改过，没有它的记录，平台是 macOS 或 Linux（`platformBehavior().treatsUnknownMpvConfAsUserOwned`） | `kept`，不写 `.fntv-new`、不算冲突，也不记录，下次仍按这一条判断 |
| `config`，改过 | `wrote-fntv-new`：原文件不动，新版写到 `<文件>.fntv-new`（已有旧的就替换），进 `conflicts`（路径加新版哈希） |

- `managedDirs`（至少 `scripts/uosc`、`scripts/uosc_danmaku`、`scripts/smart_skip`）整目录替换：目录里有文件要变时，在暂存目录复制出完整的新目录，带上旧目录里清单没列出的文件（用户自己放进去的文件），再 rename 换掉，失败时放回旧目录。
- 记录里有、新清单没有的文件（以及清单 `obsolete` 列出的文件）：哈希等于记录值才删（`removed`）；没有记录时按 `obsolete` 的 `knownHashes` 判断；改过的保留（`kept`）。记录里归属是 `config` 的一律保留。不在记录也不在 `obsolete` 里的文件不碰，例如 smart_skip 运行时写的 `script-opts/smart_skip.conf`。
- 所有新内容（含 `.fntv-new` 和安装记录）先写进用户配置根目录的 `.fntv-sync-*`，校验哈希、fsync，再 rename 到位。暂存目录放在根目录，mpv 不会把它当脚本加载。哈希不符说明便携配置和清单不一致，同步失败。
- 每次同步先清理残留的 `.fntv-sync-*`。上次停在“旧目录已移开、新目录还没到位”时（目录替换前写了 `target.json`），先把旧目录放回去，再正常同步。
- 同步失败（`failed`）：已到位的文件保留，不写新记录，记 ERROR，不阻塞启动；下次启动重跑，已到位的文件命中 `unchanged`，结果和一次跑完相同。
- 不要改回先删目标再复制：目标和来源是同一目录时，这样会把附带的插件删光（#118）。

## 默认播放方式

MPV 接管默认开启。入口是 `isMpvPlaybackEnabled`（`src/modules/fn_config/playbackPreference.ts`），配置字段沿用旧名 `hideOriginalPlayButton`。

| `hideOriginalPlayButton` | 结果 |
| --- | --- |
| `true` | MPV |
| 缺失（`undefined`） | MPV |
| `false` | 网页端自带播放器 |
| `null`、字符串、数字、对象 | 网页端自带播放器 |

这几处必须同时保持这个默认值：

- `src/modules/fn_config/config.ts` 读配置。
- `src/main/handlers/plugins/config.ts` 写配置，缺失值按 `true` 保存。
- `src/preload/core/playback.ts` 读配置，2 秒内没收到回复时回退为 `true`。
- `resource/login/index.html` 的开关默认勾选，`resource/login/settings.js` 只有明确收到 `false` 才取消。

```ts
// 错：缺失值被当成关闭，没有保存过偏好的用户会丢掉 MPV 默认。
const enabled = value === true

// 错：'false'、0、null 这类异常值也会启用 MPV。
const enabled = value !== false

// 对：所有读取方共用同一个判断。
const enabled = isMpvPlaybackEnabled(value)
```

## Proxy

Proxy 是 TypeScript 写的（`src/modules/proxy_service/`），客户端启动时用 Electron `utilityProcess.fork()` 在子进程里运行，入口是 `src/modules/proxy_service/child.ts`，主进程这一侧在 `src/main/common/proxy.ts`。决策原因见 [ADR-0004](adr/0004-proxy-in-typescript-utility-process.md)。

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

## 测试覆盖

| 行为 | 测试 |
| --- | --- |
| 用户配置同步：全新安装、已有用户有无记录、用户改过文件、冲突和已确认冲突 | `tests/mpvConfigSync.test.cjs` |
| 用户配置同步：删除归档删掉的文件、托管目录保留用户文件、整体跳过、macOS/Linux 的 `mpv.conf` 例外 | `tests/mpvConfigSyncRules.test.cjs` |
| 用户配置同步：任一次写入失败或被杀后下次启动补完、便携配置和清单不符 | `tests/mpvConfigSyncFailure.test.cjs` |
| 便携配置和清单的位置、附带 MPV 同目录、同步日志 | `tests/mpvConfigMigration.test.cjs` |
| 用户配置目录、运行哪个 MPV | `tests/platform.test.cjs` |
| 托盘显示 mpv 路径、打开用户配置目录 | `tests/trayMpvMenu.test.cjs` |
| 默认播放方式 | `tests/playbackPreference.test.cjs` |
| 经 IPC 创建播放会话，入参不变 | `tests/proxyControl.test.cjs` |
| 删除旧版 Proxy 密钥文件 | `tests/legacyProxySecret.test.cjs` |
| 播放地址不暴露登录凭据 | `tests/proxySession.test.cjs` |
| Proxy 取流和片头片尾接口 | `tests/proxyService*.test.cjs` |
| Proxy 在打包产物里启动（端口从 `app.log` 读）、客户端退出后端口关闭 | `tests/smoke/installer.smoke.cjs` |
| 退出时先停播放、等进度回传，再关 Proxy | `tests/quitCoordinator.test.cjs`、`tests/updateQuit.test.cjs` |

构建（`build.yml`）不覆盖上游插件这一条没有自动化测试，改工作流时用 `grep -n -i danmaku .github/workflows/build.yml .github/workflows/release.yml` 确认没有结果。
