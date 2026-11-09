# 依赖更新（Renovate）

相关：[构建依赖与 MPV 插件同步](build-dependencies.md)、[多平台测试策略](multi-platform-testing.md)。

## 2026-11-09 Renovate pin PR #126 的 macOS、Windows 构建失败

- 起因：`renovate.json`（#125，`39f60c7`）设了 `rangeStrategy: pin`。Renovate 开的 #126（`fix(deps): pin dependencies`，分支 `renovate/pin-dependencies`，head `1fb32c5`）除了 pin npm 依赖，还把 workflow 里的运行时版本也 pin 到补丁版本：`setup-node` 的 `node-version` `22` 改成 `22.23.4`，`build.yml` 里 `setup-python` 的 `python-version` `3.11` 改成 `3.11.18`。
- 现象：运行 [`actions/runs/42548136121`](https://github.com/JayYa/fntv-electron/actions/runs/42548136121) 里 `macos / build` 和 `windows / build` 失败，Linux 构建、冒烟测试和 `ci.yml` 三平台测试都通过。两个失败都在 `Setup Python (for native modules)` 一步：
  - Windows：`The version '3.11.18' with architecture 'x64' was not found for Windows 2025.`
  - macOS：`The version '3.11.18' with architecture 'arm64' was not found for macOS 26.7.2.`
- 根因：是 PR 本身引入的，不是偶发，重跑没有用。2026-11-09 查 `actions/python-versions` 的 `versions-manifest.json`：3.11 系列最后一个带 `win32` 和 `darwin` 构建的是 3.11.9；3.11.10 及以后（3.11 进入只发源码的安全维护期）只有 `linux` 和 `rhel` 构建。所以 `3.11.18` 在 Linux 上能装，在 Windows 和 macOS 上找不到。`3.11` 不 pin 时，`setup-python` 在 Windows、macOS 上取的是能找到的最新 3.11。`ci.yml` 不装 Python，所以测试 job 不受影响。
- Node 的 pin（`22.23.4`）三个平台都装上了，不是失败原因。
- 修复：`renovate.json` 加一条 `packageRules`，对 `github-actions` 管理器 `uses-with` 类型的 `python` 关掉 `pin` 更新，`python-version` 保持 `3.11`。`renovate-config-validator` 校验通过。合并后 Renovate 下次运行会重建 #126，不再改 `python-version`。不往 `renovate/*` 分支推提交，Renovate 会停止维护被人改过的分支。
- 同一个 PR 里另外看到：Renovate 改 `pnpm-workspace.yaml`（把 `extract-zip>yauzl` 的 `^3.4.0` pin 成 `3.4.0`）时，删掉了文件开头关于 `.npmrc` 和 `nodeLinker` 的两段注释，其它注释保留。不影响构建；合并 #126 前要决定是否接受，或之后补回。
