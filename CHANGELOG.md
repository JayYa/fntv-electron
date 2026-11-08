# 更新日志

## [2.8.0](https://github.com/JayYa/fntv-electron/compare/v2.7.2...v2.8.0) (2026-11-08)


### 新功能

* **mpv:** 附带的 MPV 升级到 20261108，新增缩略图预览 ([#123](https://github.com/JayYa/fntv-electron/issues/123)) ([bfc2f10](https://github.com/JayYa/fntv-electron/commit/bfc2f109002b6f0428706de0c1bfffd1115505f3))


### 问题修复

* **logger:** 打包后的日志写在 ~/.fntv/logs ([#108](https://github.com/JayYa/fntv-electron/issues/108)) ([a364c2f](https://github.com/JayYa/fntv-electron/commit/a364c2f3fc43715881e1a3da41bc15896b2c855d))
* **mpv:** 同步 MPV 配置时识别 portable_config 和旧的 ~/.mpv ([#117](https://github.com/JayYa/fntv-electron/issues/117)) ([cfef805](https://github.com/JayYa/fntv-electron/commit/cfef805c77b5c3ec8f612fccec3aff54259cf694))
* **mpv:** 用户 MPV 配置目录按 MPV_HOME、XDG_CONFIG_HOME 和漫游 AppData 取 ([#77](https://github.com/JayYa/fntv-electron/issues/77)) ([#113](https://github.com/JayYa/fntv-electron/issues/113)) ([0e411a9](https://github.com/JayYa/fntv-electron/commit/0e411a98dd2d7821e30d0aae6141a8da96800245))
* **mpv:** 自选 MPV 是附带的 MPV 时不再清空弹幕插件 ([#120](https://github.com/JayYa/fntv-electron/issues/120)) ([626a979](https://github.com/JayYa/fntv-electron/commit/626a9797d667fc5b1d917a9e689f4e37868a00f7))
* **platform:** Linux 和 macOS 用 PNG 窗口图标，Linux 托盘单击恢复窗口，只留一个 window-all-closed 监听 ([#110](https://github.com/JayYa/fntv-electron/issues/110)) ([2f84796](https://github.com/JayYa/fntv-electron/commit/2f847963e55f5c990ff7349d4302706cf6ce0bb3))
* **updater:** 按 expectedAssetName 精确查找安装包 ([#111](https://github.com/JayYa/fntv-electron/issues/111)) ([c63d4d2](https://github.com/JayYa/fntv-electron/commit/c63d4d240b1904e575b90bc6efd19e3b24f7efbe))

## [2.7.2](https://github.com/JayYa/fntv-electron/compare/v2.7.1...v2.7.2) (2026-11-08)


### 问题修复

* **proxy:** 不从安装目录启动时（如快捷方式改了起始位置），Windows 版也能正常启动 Proxy，不再弹「文件不存在」后卡住 ([#91](https://github.com/JayYa/fntv-electron/issues/91)) ([99ae40d](https://github.com/JayYa/fntv-electron/commit/99ae40d3cc41d4383a812d5feff9be8ae8d3a053))
* **ui:** 托盘菜单和登录页设置面板写明是哪种代理，并按代码整理领域词汇表 ([#69](https://github.com/JayYa/fntv-electron/issues/69)) ([eb90632](https://github.com/JayYa/fntv-electron/commit/eb906323d0420d3301691de3f9f4dac82888ada9))

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
