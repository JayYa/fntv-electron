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
- 已被取代（2026-11-09，见下一节：维护者决定不补回这两段注释）：~~同一个 PR 里另外看到：Renovate 改 `pnpm-workspace.yaml`（把 `extract-zip>yauzl` 的 `^3.4.0` pin 成 `3.4.0`）时，删掉了文件开头关于 `.npmrc` 和 `nodeLinker` 的两段注释，其它注释保留。不影响构建；合并 #126 前要决定是否接受，或之后补回。~~

## 2026-11-09 #126、#127、#129 合并，删除没用到的 @types 包

- 维护者合并了 #129（`e74c6aa`，上一节的 `renovate.json` 修复）、#127（`def16be`，`fix(deps): update all non-major dependencies`）和 #126（`f139460`，`fix(deps): pin dependencies`）。
- #126 在 #129 合并后由 Renovate 重建，重建后没有再 pin `python-version`；macOS、Windows 构建和冒烟测试都通过，上一节的修复已验证。
- #127 的主要变化：`build.yml` 的 `python-version` `3.11` 改成 `3.15`（上一节说的“保持 `3.11`”从这里起不再成立）；`src/modules/proxy/go.mod` 的 `go` 指令 `1.24.0` 改成 `1.26.0`；`sharp` `^0.34.3` 改成 `^0.35.0`；`electron` `v38.0.0` 改成 `38.8.6`。
- `pnpm-workspace.yaml` 开头被 Renovate 删掉的两段注释，维护者决定不补回。
- Renovate Dependency Dashboard（#128）把 `@types/cacheable-request`、`@types/keyv`、`@types/responselike` 标为 deprecated（这些包现在自带类型，`@types` 只剩空壳），并为前两个开了 major PR #130、#131。核实结果：
  - 这三个包和 `@types/debug`、`@types/fs-extra`、`@types/http-cache-semantics`、`@types/ms`、`@types/plist`、`@types/verror`、`@types/yauzl` 是 `7cd6902`（`[fix] build`，2025-09-02）一起加进 `devDependencies` 的，正好是 `electron`、`electron-builder` 依赖树里的 `@types` 包。`tsconfig.json` 没有 `types` 字段，只有 `typeRoots: ["./node_modules/@types"]`，所以 `node_modules/@types` 下的包都会自动加载；`src`、`tests`、`scripts`、`resource/login` 都没有直接导入这些模块。
  - `@types/express`（`ae48e75` 加）和 `@types/multistream`（`ce934db` 加）是给原来 TypeScript 写的代理服务用的，代理改用 Go 后 `src` 里已经不导入 `express`、`multistream`。
  - `@types/cacheable-request@6.0.3`、`@types/keyv@3.1.4`、`@types/responselike@1.0.3` 仍经 `got@11.8.6`（`@electron/get` 依赖）间接安装，删掉直接依赖不影响它们被加载，也不会装上 #130、#131 的空壳版本。
- 结论：这 12 个 `@types` 包从 `devDependencies` 删掉，只留 `@types/node`。本地 `pnpm install`、`tsc --noEmit`、`pnpm run lint`、`pnpm test`（351 通过，1 跳过）都通过。这个 PR 取代 #130、#131，依赖消失后 Renovate 会自动关闭它们。
- 另外看到：`dependencies` 里的 `express`、`multistream`、`http-proxy-middleware`、`http-range-fetcher`、`uuid` 在 `src` 里也没有导入，可能同样是 TypeScript 代理服务留下的。这次没动。
