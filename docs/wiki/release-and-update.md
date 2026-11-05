# 发布与更新链路

相关：[独立维护](independent-maintenance.md)。

## 2026-11-05 事实（`JayYa/fntv-electron@af416c0`）

- 更新检查是自写的，只提示并打开下载链接，不自动安装。更新源写死 `QiaoKes/fntv-electron`，且读 GitHub `releases/latest`，不包含 prerelease 和 draft。（更新源部分已被下方 2026-11-05 PR #24 记录取代）
- `JayYa/fntv-electron` 没有 Release、tag、secret，也从未跑过 workflow。（“从未跑过 workflow”已被下方记录取代）
- 已安装的上游版本不会迁移到本仓库的更新源。
- 下载代理默认开启，链接经 `ghfast.top` 中转。
- Linux x64 产物名含 `x86_64`，而更新匹配只认 `x64`。（已被下方记录取代）
- 安装包没有代码签名。

## 2026-11-05 事实（GitHub）

- GitHub fork 不带 Release。`JayYa/fntv-mpv-config` 刚 fork 时只有 tag，构建需要的 zip 资产要单独镜像。（镜像已完成，见下方记录）
- 上游 `fntv-mpv-config` 最新 Release 是 `fntv-mpv-v20260826_013404`。

## 2026-11-05 待评估（首次公开发版前）

- 版本号必须高于 2.6.2，tag 必须是合法 semver。
- 重新评估 `ghfast.top` 默认代理和未签名安装包。

## 2026-11-05 PR #24 记录（`JayYa/fntv-electron@f71ea84`，尚未合并）

- 更新源收敛为 `UPDATE_REPOSITORY`，指向 `JayYa/fntv-electron`。404 视为暂无更新。Linux x64 同时匹配 `x64` 和 `x86_64`。
- Release Build 只能手动触发，不创建 Release，产物留在 Actions artifacts。
- `JayYa/fntv-mpv-config` 已建 `fntv-mpv-v20260826_013404` 镜像 Release，构建固定 tag 并校验 sha256。
- `package.json` 加 `repository` 后，electron-builder 在 CI 上会隐式发布。打包脚本因此都带 `--publish never`。
- Release Build 首次成功运行：`actions/runs/41963636062`（head `c78c9de`）。

## 2026-11-05 待办

- 三个 PR 合并后，`release` 分支上的旧 workflow 仍可能被 push 触发（未实测），且它带 `contents: write` 和 `GH_TOKEN`。需要维护者决定快进或删除该分支。
