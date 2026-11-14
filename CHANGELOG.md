# 更新日志

## [3.4.0](https://github.com/JayYa/fntv-electron/compare/v3.3.0...v3.4.0) (2026-11-14)


### 新功能

* **ci:** 新增 pnpm run check 作为统一验证入口，加 Check 汇总 job ([#213](https://github.com/JayYa/fntv-electron/issues/213)) ([17ffa22](https://github.com/JayYa/fntv-electron/commit/17ffa22319a0da426da606c0a1a474f68d85cd60))

## [3.3.0](https://github.com/JayYa/fntv-electron/compare/v3.2.0...v3.3.0) (2026-11-14)


### 新功能

* **ci:** 合并到 main 后也跑一遍 lint、knip 和三平台测试 ([#211](https://github.com/JayYa/fntv-electron/issues/211)) ([c930d8c](https://github.com/JayYa/fntv-electron/commit/c930d8c75a41d616d1b89372f198af210e117dca))
* **ci:** 打包后核对更新元数据的文件名、size 和 sha512，不一致让构建失败 ([#208](https://github.com/JayYa/fntv-electron/issues/208)) ([8023a34](https://github.com/JayYa/fntv-electron/commit/8023a3419c62f755a9f1cab909224d0ddcf8dab8))
* **ci:** 文件大小检查加 80% 预警，并在 PR 的 CI 里检查改动的文件 ([#204](https://github.com/JayYa/fntv-electron/issues/204)) ([fe7ee76](https://github.com/JayYa/fntv-electron/commit/fe7ee76a5374e7659fb2deb4486c057bb5823f99))
* **updater:** 下载加速默认中转地址改为 gh-proxy.com，旧默认值读配置时迁移 ([#206](https://github.com/JayYa/fntv-electron/issues/206)) ([24e3ba3](https://github.com/JayYa/fntv-electron/commit/24e3ba3d5fbc096138d8d5704cb1753cc4638f2f))


### 问题修复

* **deps:** update all non-major dependencies ([#199](https://github.com/JayYa/fntv-electron/issues/199)) ([8904c9e](https://github.com/JayYa/fntv-electron/commit/8904c9ec543a2b592f2a3fe794e352799e3373ea))
* **tray:** 退出时安装期间托盘图标不再被提前销毁 ([#187](https://github.com/JayYa/fntv-electron/issues/187)) ([a7e3a69](https://github.com/JayYa/fntv-electron/commit/a7e3a6935fa9342744ee56fdacb23399dce5d342))
* **updater:** 安装前等进度回传最多 5 秒，回传不返回时照常安装 ([#202](https://github.com/JayYa/fntv-electron/issues/202)) ([f9e8ff7](https://github.com/JayYa/fntv-electron/commit/f9e8ff7bc00ee6c5af54c1a3313fa1dfdc41645a))
* **updater:** 系统关机、重启或注销时放弃「退出时安装」，下次检查到更新时再装 ([#210](https://github.com/JayYa/fntv-electron/issues/210)) ([ba513d4](https://github.com/JayYa/fntv-electron/commit/ba513d4d11dc5d7b7c66ba686fce67c461d119ea))
* 退出客户端时先等这次播放的进度回传完成（最多 5 秒），再关闭播放服务 ([#209](https://github.com/JayYa/fntv-electron/issues/209)) ([a9cd25e](https://github.com/JayYa/fntv-electron/commit/a9cd25e20841e82c7724d04f807eed58308a1c10))

## [3.2.0](https://github.com/JayYa/fntv-electron/compare/v3.1.0...v3.2.0) (2026-11-12)


### 新功能

* **updater:** Windows 和 Linux 支持应用内更新，客户端自己下载并在重启时安装 ([#184](https://github.com/JayYa/fntv-electron/issues/184)) ([c8a4d35](https://github.com/JayYa/fntv-electron/commit/c8a4d35059ce02536e9788d652e78d0e55c862dd))

## [3.1.0](https://github.com/JayYa/fntv-electron/compare/v3.0.0...v3.1.0) (2026-11-11)


### 新功能

* **proxy:** Proxy 改用 TypeScript，移除 Go 组件 ([#168](https://github.com/JayYa/fntv-electron/issues/168)) ([259a581](https://github.com/JayYa/fntv-electron/commit/259a5815124c8f9644ad4a90da5302afe650996c))
* **proxy:** Proxy 监听随机端口，smart_skip 按播放地址取端口 ([#170](https://github.com/JayYa/fntv-electron/issues/170)) ([aad4de1](https://github.com/JayYa/fntv-electron/commit/aad4de10169627028eaade554255e2e1a00f2ff8))
* **tray:** 托盘总是显示当前 MPV 路径，新增打开 MPV 用户配置目录 ([#174](https://github.com/JayYa/fntv-electron/issues/174)) ([ea51fcf](https://github.com/JayYa/fntv-electron/commit/ea51fcfcc695a3bbd9d70a7027e975b710e35f3d))


### 问题修复

* **tray:** 取不到 MPV 用户配置目录时托盘照常创建，不让客户端启动失败 ([#176](https://github.com/JayYa/fntv-electron/issues/176)) ([e216263](https://github.com/JayYa/fntv-electron/commit/e216263446b7348d96e03044b69763a68a687f10))

## [3.0.0](https://github.com/JayYa/fntv-electron/compare/v2.8.0...v3.0.0) (2026-11-09)


### ⚠ BREAKING CHANGES

* **deps:** 升级 Electron 到 45，macOS 最低版本改为 13（Ventura） ([#149](https://github.com/JayYa/fntv-electron/issues/149))

### 新功能

* **deps:** 升级 Electron 到 45，macOS 最低版本改为 13（Ventura） ([#149](https://github.com/JayYa/fntv-electron/issues/149)) ([efa66c2](https://github.com/JayYa/fntv-electron/commit/efa66c2a5d4cb01e8bb3678f556c2efb5c3d2451))


### 问题修复

* **deps:** pin dependencies ([#126](https://github.com/JayYa/fntv-electron/issues/126)) ([f139460](https://github.com/JayYa/fntv-electron/commit/f1394608fb7f7330d499278ad5b3d746cf769a0c))
* **deps:** update all non-major dependencies ([#127](https://github.com/JayYa/fntv-electron/issues/127)) ([def16be](https://github.com/JayYa/fntv-electron/commit/def16bedb945ac3260235944162562474a961bf6))
* **mpv:** 播放时不再连上自己开着的 MPV，MPV 消息分段到达时不再报错 ([#151](https://github.com/JayYa/fntv-electron/issues/151)) ([2d0bdaa](https://github.com/JayYa/fntv-electron/commit/2d0bdaaafc353c62a59da8f4042cca81c7b87742))
* **renovate:** 不把 setup-python 的 python-version pin 到补丁版本 ([#129](https://github.com/JayYa/fntv-electron/issues/129)) ([e74c6aa](https://github.com/JayYa/fntv-electron/commit/e74c6aa54df8d2b0c5194f1a75ddd0a40142d331))

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
