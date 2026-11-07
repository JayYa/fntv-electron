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
