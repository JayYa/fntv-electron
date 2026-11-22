---
status: accepted
---

# 更新检查与弹窗生命周期

`src/modules/updater/updateChecker.ts` 负责版本检查、下载链接改写以及更新弹窗时机。应用内更新的平台可用性与元数据校验见 [ADR-0003](0003-release-gate.md) 和 [ADR-0011](0011-platform-behavior-facts.md)。

## 检查源、重试与回退

- 优先请求 GitHub Releases API；当仓库尚未发布任何 Release 时 GitHub 返回 404，视为“暂无更新”而非检查失败。
- API 请求使用指数退避重试，但只重试网络错误和 5xx，4xx 原样抛出：4xx 在几秒内不会恢复，重试只会白白消耗 GitHub API 额度。
- 触发限流时将恢复时间 `rateLimitedUntil` 记在内存中，恢复前不再请求 API。API 失败或处于限流期时，回退到请求 GitHub Release 页面的重定向拿最新 tag（`fetchLatestTagFromReleasePage`），再按构建命名规则（`expectedAssetName`）拼出安装包链接。

## 下载加速中转

- 开启应用更新下载加速时，对包含 `github.com` 的地址加上中转前缀（去掉前缀末尾斜杠后拼接原地址）。手动下载的安装包链接和应用内更新的 `electron-updater` 更新源都按同一规则改写。

## 弹窗与播放、退出生命周期

- 自动检查更新失败时只记日志、不弹错误框，避免打扰用户；手动检查更新则向用户展示所有结果和错误。
- 自动检查发现新版本时，若 MPV 正在播放则推迟弹窗，等播放结束后再弹一次。新的推迟提示会替换旧的；客户端退出或用户主动手动检查已弹框时作废推迟提示。
- 退出流程里停止播放也会触发 `onPlaybackEnded`，因此必须在 `onQuitStarted`（停止播放之前）取消推迟的更新提示。
- 用户主动手动检查时，即使正在播放也立即弹框，并取消此前推迟的提示。
- 用户选择“下载并安装”后在后台启动 `inAppUpdate.downloadAndInstall()`，不阻塞对话框调用返回；下载失败时的错误提示由 `InAppUpdate` 自行弹出。
