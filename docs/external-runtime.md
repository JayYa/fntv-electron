# 外部运行时归属

改打包的 MPV、MPV 插件、用户 MPV 配置同步、默认播放方式或本地 Go Proxy 生命周期时读这份文档。决策原因见 [ADR-0001](adr/0001-mpv-bundle-and-runtime-ownership.md)。

## 术语

- **MPV 归档**：`fntv-mpv-config` 发布的完整 zip，解压到 `third_party/fntv-mpv`。
- **便携配置**：归档里的 `portable_config`，是同步的来源，由 `resolvePortableConfigDir` 定位。
- **用户配置**：同步的目标，按 mpv 自己的查找规则定（`mpvUserConfigDir`，`src/public/platform.ts`）：设了 `MPV_HOME` 就是它；否则 Windows 是 `app.getPath('appData')` 下的 `mpv`（通常是 `%APPDATA%mpv`），其它平台是 `$XDG_CONFIG_HOME/mpv`，未设或不是绝对路径时 `~/.config/mpv`。Windows 上用打包的 mpv 时，`media.ts` 用 `--config-dir` 把同一个目录传给 mpv。Windows 上用户自己指定的 `mpv.exe` 旁边有 `portable_config` 时，mpv 只读那里，同步也写那里（`MPV_HOME` 仍优先，#114）；指定的是 scoop 之类的 shim 时找不到真实 `mpv.exe` 旁边的目录，不处理。macOS 和 Linux 上标准目录不存在而 `~/.mpv` 存在时，同步写 `~/.mpv`，不新建标准目录（#115）。同步只在客户端启动时进行，改了 MPV 播放器路径后要重启客户端才同步到新目录。

## MPV 归档

- MPV 和插件的版本只在 `fntv-mpv-config/package_cfg.json` 固定。
- Electron 构建只下载这一个归档，不再从上游插件分支覆盖文件。下载逻辑在 `.github/workflows/build.yml` 的 `Download third-party dependencies` 步骤。
- 该步骤固定下载 `JayYa/fntv-mpv-config` 的 tag `fntv-mpv-v20260826_013404`，并校验 sha256。这个 Release 是上游同 tag 的镜像，因为 GitHub fork 不带 Release。
- tag、资产名和 sha256 写在 `build` job 的 `env`。压缩包缓存在 `$RUNNER_TEMP/mpv-archive`，key 含 sha256，换版本时自动失效。缓存用 `actions/cache/restore` 和 `actions/cache/save` 分开写，下载并校验通过后立即保存，后面的构建失败也不丢；命中时不保存，缓存出错不让构建失败。命中缓存也校验 sha256，不通过就重新下载。未命中时 `curl` 对所有错误重试 5 次，每次隔 10 秒，最多 5 分钟，避免 Release 下载偶发的 5xx 让构建失败。这些由 `tests/releaseGate.test.cjs` 检查。
- electron-builder 打包时下载的 Electron zip 和打包工具也缓存，key 是 `runner.os` 加 `pnpm-lock.yaml` 的 hash，构建成功后保存，命中时不保存。打包工具存在 `ELECTRON_BUILDER_CACHE`（`Build application` 设为 `$RUNNER_TEMP/electron-builder-cache`）。Electron zip 存在 `@electron/get` 的默认目录（Linux `~/.cache/electron`，macOS `~/Library/Caches/electron`，Windows `%LOCALAPPDATA%\electron\Cache`），它不读 `ELECTRON_CACHE`。
- 升级归档时，先在 `JayYa/fntv-mpv-config` 发布新 Release，再同时改 `build` job `env` 里的 tag、资产名和 sha256，以及 `README.md` 的准备步骤。
- Windows 打包整个 `third_party/fntv-mpv`，含 `mpv.exe`。macOS 和 Linux 只打包 `portable_config`（`package.json` 的 `extraFiles`）。

## 用户配置同步

入口是 `synchronizeMpvConfig`（`src/main/common/mpvConfigHelpers.ts`）。是否“首次”只看用户配置里有没有 `scripts` 目录。

| 状态 | 行为 | 返回值 |
| --- | --- | --- |
| 便携配置目录不存在 | 抛错 | 无 |
| 用户配置就是便携配置（按 realpath 比较，例如自选 mpv 就是附带的 mpv，#118） | 什么都不动 | `same-directory` |
| 用户配置没有 `scripts` | 复制便携配置，已存在的文件一律跳过；之后 `scripts/uosc_danmaku/main.lua` 不存在时抛错 | `initialized` |
| 用户配置已有 `scripts` | 在用户配置根目录的 `.fntv-sync-*` 暂存目录里复制出新的 `uosc_danmaku`，再换掉旧目录，其它文件不动 | `updated` |
| 已有 `scripts`，但便携配置缺 `scripts/uosc_danmaku` 或其中的 `main.lua` | 抛错，旧插件不动 | 无 |

- 只有 `scripts/uosc_danmaku` 由应用托管。
- `danmaku-history.json`、`script-opts` 和其它脚本归用户所有，同步时逐字节保留。内容为空或损坏也不修复。
- 同步抛错时 `mpvConfig.ts` 只记录 ERROR 日志，不阻塞启动，也不记“已同步”。
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

## Proxy 密钥

Proxy 监听 `127.0.0.1:22345`。密钥保护本机控制接口，防的是 Electron 渲染的远程网页。它不是登录凭据，也防不住同一系统用户下的其它进程。

- `userData/proxy-secret`（即 `~/.fntv/proxy-secret`）保存 32 字节随机值，格式是 64 位小写十六进制，不带换行。
- 重启 Proxy 或 Electron 都复用这份密钥。入口是 `loadOrCreateProxySecret`（`src/main/common/proxySecret.ts`）。
- 写入时先写临时文件再改名，权限 `0600`，读取已有文件时也重设权限。Windows 上 `0600` 没有实际效果。
- 只通过 stdin（启动 Proxy）和 `X-FNTV-Proxy-Secret` 请求头（`/health`、`/api/v1/session`）传递。
- 密钥不进命令行参数、环境变量、URL 和日志。

```ts
// 错：每次启动换密钥，异常退出后留下的 Proxy 无法认证，还占着固定端口。
const secret = randomBytes(32).toString('hex')

// 对：一份持久化的密钥跨重启识别本地 Proxy。
const secret = loadOrCreateProxySecret(app.getPath('userData'))
```

| 状态 | 行为 |
| --- | --- |
| 密钥文件不存在 | 生成并原子写入 |
| 密钥文件合法 | 原样复用 |
| 密钥文件格式不对（含末尾换行） | 原子替换为新密钥 |
| 读取失败（`ENOENT` 以外） | 抛出原始错误，启动失败，不重建 |
| `/health` 返回 200 且 `service` 是 `fntv-proxy`、`protocol` 是 `2` | 复用这个 Proxy |
| `/health` 返回其它结果 | 不复用，启动新进程；端口仍被占用时启动失败 |

## 播放会话

- 播放地址只带 `session`，不带 Proxy 密钥和登录 token（`src/main/common/proxySession.ts`）。
- `session` 是 64 位十六进制，有效期 24 小时，每次访问顺延（`src/modules/proxy/internal/logic/api/session.go`）。
- 每个会话只允许访问创建时列出的 `itemGuids`。
- `session` 等同于访问能力，所以 Proxy 用 `gin.New()` 关掉了访问日志，Electron 日志会脱敏（`tests/sessionMasking.test.cjs`）。

## 测试覆盖

| 行为 | 测试 |
| --- | --- |
| 用户配置同步 | `tests/mpvConfigMigration.test.cjs` |
| 用户配置目录、Proxy 可执行文件路径 | `tests/platform.test.cjs` |
| 默认播放方式 | `tests/playbackPreference.test.cjs` |
| 密钥持久化、权限、孤儿 Proxy 认证 | `tests/proxySecret.test.cjs` |
| 健康检查响应 | `tests/proxyHealth.test.cjs`、`src/modules/proxy/internal/logic/register_test.go` |
| 播放地址不暴露密钥 | `tests/proxySession.test.cjs` |

构建（`build.yml`）不覆盖上游插件这一条没有自动化测试，改工作流时用 `grep -n -i danmaku .github/workflows/build.yml .github/workflows/release.yml` 确认没有结果。
