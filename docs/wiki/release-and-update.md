# 发布与更新链路

相关：[独立维护](independent-maintenance.md)。

## 2026-11-05 事实（`JayYa/fntv-electron@af416c0`）

- 更新检查是自写的，只提示并打开下载链接，不自动安装。更新源写死 `QiaoKes/fntv-electron`，且读 GitHub `releases/latest`，不包含 prerelease 和 draft。
- `JayYa/fntv-electron` 没有 Release、tag、secret，也从未跑过 workflow。
- 已安装的上游版本不会迁移到本仓库的更新源。
- 下载代理默认开启，链接经 `ghfast.top` 中转。
- Linux x64 产物名含 `x86_64`，而更新匹配只认 `x64`。
- 安装包没有代码签名。

## 2026-11-05 事实（GitHub）

- GitHub fork 不带 Release。`JayYa/fntv-mpv-config` 刚 fork 时只有 tag，构建需要的 zip 资产要单独镜像。
- 上游 `fntv-mpv-config` 最新 Release 是 `fntv-mpv-v20260826_013404`。

## 2026-11-05 待评估（首次公开发版前）

- 版本号必须高于 2.6.2，tag 必须是合法 semver。
- 重新评估 `ghfast.top` 默认代理和未签名安装包。
