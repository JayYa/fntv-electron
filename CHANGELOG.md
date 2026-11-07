# 更新日志

## [2.7.1](https://github.com/JayYa/fntv-electron/compare/v2.7.0...v2.7.1) (2026-11-07)


### 问题修复

* **updater:** 更新提示框显示完整的更新说明，条目前不再带英文模块名 ([#66](https://github.com/JayYa/fntv-electron/issues/66)) ([5b63e64](https://github.com/JayYa/fntv-electron/commit/5b63e64b01f2edec4496466622bf7088801266a2))
* **updater:** 检查更新遇到 GitHub 访问次数用完时，提示几点可重试并改用备用方式查新版本 ([#68](https://github.com/JayYa/fntv-electron/issues/68)) ([5570836](https://github.com/JayYa/fntv-electron/commit/557083622ed5727f2eb101b66c96a39dcb37254a))

## [2.7.0](https://github.com/JayYa/fntv-electron/compare/v2.6.2...v2.7.0) (2026-11-07)


### 新功能

* **login:** 登录页显示原作者和当前维护者 ([d9e675b](https://github.com/JayYa/fntv-electron/commit/d9e675b70b923c72ed03f5486c91b39c1dfa98c8))
* **player:** 剧集详情页、季详情页的播放键和“继续观看”菜单里的“继续播放”改用 MPV 播放 ([d9e675b](https://github.com/JayYa/fntv-electron/commit/d9e675b70b923c72ed03f5486c91b39c1dfa98c8))
* **player:** 用 MPV 播完的电影和剧集自动标记为已观看 ([d9e675b](https://github.com/JayYa/fntv-electron/commit/d9e675b70b923c72ed03f5486c91b39c1dfa98c8))
* **player:** 选“从头开始播放”时 MPV 从头播放，并清除已保存的播放进度 ([d9e675b](https://github.com/JayYa/fntv-electron/commit/d9e675b70b923c72ed03f5486c91b39c1dfa98c8))


### 问题修复

* **config:** 配置文件损坏时先备份原文件再写入，登录记录里的异常条目不再影响读取 ([d9e675b](https://github.com/JayYa/fntv-electron/commit/d9e675b70b923c72ed03f5486c91b39c1dfa98c8))
* **config:** 重装系统或换电脑后已保存的密码解不开时，应用照常启动，重新登录即可 ([d9e675b](https://github.com/JayYa/fntv-electron/commit/d9e675b70b923c72ed03f5486c91b39c1dfa98c8))
* **fnid:** FN ID 登录只向已确认的 NAS 页面填写密码和访问码 ([d9e675b](https://github.com/JayYa/fntv-electron/commit/d9e675b70b923c72ed03f5486c91b39c1dfa98c8))
* **login:** 用 HTTPS 连接 HTTP 端口时，登录页提示检查 HTTPS 设置 ([d9e675b](https://github.com/JayYa/fntv-electron/commit/d9e675b70b923c72ed03f5486c91b39c1dfa98c8))
* **login:** 登录页只在选中某条登录记录时才读取它的密码和访问码 ([d9e675b](https://github.com/JayYa/fntv-electron/commit/d9e675b70b923c72ed03f5486c91b39c1dfa98c8))
* **log:** 日志里的内网 IP、FN ID 和用户名会被脱敏 ([d9e675b](https://github.com/JayYa/fntv-electron/commit/d9e675b70b923c72ed03f5486c91b39c1dfa98c8))
* **security:** 主窗口启用沙箱，登录页禁止内联脚本，降低网页内容带来的风险 ([d9e675b](https://github.com/JayYa/fntv-electron/commit/d9e675b70b923c72ed03f5486c91b39c1dfa98c8))
* **updater:** 新版本下载默认直连 GitHub，不再经过第三方代理 ([d9e675b](https://github.com/JayYa/fntv-electron/commit/d9e675b70b923c72ed03f5486c91b39c1dfa98c8))
* **updater:** 更新提示框里的更新说明显示为纯文本，内容过长时提示查看详情 ([d9e675b](https://github.com/JayYa/fntv-electron/commit/d9e675b70b923c72ed03f5486c91b39c1dfa98c8))
* **updater:** 检查更新改为从本仓库获取新版本，还没有发布过版本时不再报错 ([d9e675b](https://github.com/JayYa/fntv-electron/commit/d9e675b70b923c72ed03f5486c91b39c1dfa98c8))

## 2.6.2 (2026-08-26)

### 更新内容

- 新增 fnOS 访问码登录支持，登录页可直接填写访问码，无需先在浏览器中验证。
- 支持记住访问码并在应用重启后自动恢复登录状态。
- 修复访问码保护的 NAS 无法播放视频的问题。
- 恢复 MPV 为默认播放方式，仍可在设置中切换为网页播放。
- 修复部分服务器地址带末尾斜杠时导致播放地址异常的问题。
- 改善 macOS 下 Proxy 服务的启动和更新流程。
- 升级 MPV 弹幕插件。

### 升级说明

- 访问码为可选项，未启用 fnOS 访问码的服务器无需填写。
- 已保存的账号、密码和登录历史会继续保留；访问码会随对应的登录记录保存。
- macOS 用户首次从源码启动时请使用 `pnpm run start:mac`，以确保加载匹配当前系统的 Proxy。

### 支持平台

- Windows x64
- macOS Intel / Apple Silicon
- Linux x64 / ARM64
