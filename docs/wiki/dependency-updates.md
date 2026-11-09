# 依赖更新（Renovate）

相关：[构建依赖与 MPV 插件同步](build-dependencies.md)、[多平台测试策略](multi-platform-testing.md)、[依赖更新（TypeScript 6 之后）](dependency-updates-ts6.md)。

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
- 已被取代（2026-11-09，见下一节：已核实并在 #136 删除）：~~另外看到：`dependencies` 里的 `express`、`multistream`、`http-proxy-middleware`、`http-range-fetcher`、`uuid` 在 `src` 里也没有导入，可能同样是 TypeScript 代理服务留下的。这次没动。~~

## 2026-11-09 #133 合并，major 更新的处理方式，删除旧代理留下的运行时依赖

- 维护者合并了 #133（`b993558`，上一节删 `@types` 包的 PR）。
- 维护者 2026-11-09 的决定：
  - major 更新等 Renovate 按速率限制陆续开出，不手动在 Dependency Dashboard（#128）里一次全部创建。
  - 低风险的 major PR，CI 通过并看过改动后交维护者合并。`electron` 45、TypeScript 7、Node 26 单独评估。
  - release 2.8.1（#132）推迟到这批更新之后再发。
- 上一节“另外看到”的 5 个包，PR #136 逐个核实（基于 `b993558`）：
  - 范围：`git grep` 全仓库（`src`、`tests`、`scripts`、`resource/`、`.github`，含 preload 入口和 `resource/login` 页面），`tsc` 编译产物 `dest/` 里的 `require`，`scripts/build-preload.cjs`（esbuild 只打 preload），`package.json` 的 `build.files` 和 `extraFiles`。唯一的动态 `require` 是 `src/main/handlers/index.ts` 加载 `plugins/*.js`，插件源码在 `src` 里，已覆盖。
  - 来历（`git log -S`）：`express` 由 `ae48e75`（2025-09-04）加，`http-proxy-middleware` 和 `uuid`（`uuidv5` 生成 ID）由 `54c2452`（2025-09-13）加，`multistream` 和 `http-range-fetcher` 由 `ce934db`（2025-09-14）加，都给 `src/modules/proxy/server.ts`、`utils.ts` 用。`837782f`（`[add] support 302`，2025-09-14）把代理改成 Go 并删掉这些 `.ts`，之后没有代码再导入它们。`http-range-fetcher` 从来没在 `src` 里导入过。
  - 其它 `dependencies` 都有用：`axios`（`fn_api/request.ts`、`updater/*`）、`node-cache`（`fn_api/api.ts`）、`node-mpv-2`（`players/impl/mpv.ts`）、`semver`（`updater/updateChecker.ts`，`try { require('semver') }`，缺失时退回简单比较）。
- 结论：5 个包从 `dependencies` 删掉，lockfile 少 119 个包。本地 `tsc --noEmit`、`pnpm run lint`、`pnpm test`（351 通过，1 跳过）都通过。Dashboard 里 `http-proxy-middleware` v4、`uuid` v14 两个 major 更新随之不再需要。

## 2026-11-09 评估 Renovate PR #135（eslint 9 → 10）

- #135（`chore(deps): update dependency eslint to v10`，分支 `renovate/major-eslint-monorepo`，head `913fc63`，基于 `b993558`）只改 `package.json` 的 `eslint` `9.39.4` → `10.14.0` 和 `pnpm-lock.yaml`。CI 全部通过，含 `ci.yml` 三平台测试里的 `pnpm run lint`。
- 对照官方 [migrate-to-10.0.0](https://eslint.org/docs/latest/use/migrate-to-10.0.0)（2026-11-09 查）逐条核对，本项目都不受影响：
  - Node.js 要求 `^20.19 || ^22.13 || >=24`：三个 workflow 的 `node-version` 都是 `22.23.4`。
  - 删除 eslintrc：本项目只有 flat config `eslint.config.mjs`，没有 `.eslintrc*`，不用 `FlatCompat`、`@eslint/js`（eslint 10 不再依赖它）。
  - 配置文件改为从被检查文件所在目录向上查找：`lint` 脚本只查 `src`、`resource/login`、`tests`，下面都没有别的 `eslint.config.*`，仍用根目录那份。
  - `eslint:recommended` 新增规则：本项目不启用 `eslint:recommended`，规则都是 `eslint.config.mjs` 里显式列出的。
  - `/* eslint-env */` 报错、`radix`、`func-names`、`no-shadow-restricted-names`、`no-invalid-regexp` 选项变化、glob 的 POSIX 字符类、JSX 引用跟踪、`LintMessage.nodeType` 删除：`git grep` 在 `src`、`tests`、`resource/login`、`scripts` 和配置里都没有用到。
  - 插件 API 的删除（`context`、`SourceCode` 旧方法等）只影响插件：`typescript-eslint` 8.72.1 及 `@typescript-eslint/{eslint-plugin,parser,utils}` 的 peer 依赖都是 `eslint: ^8.57.0 || ^9.0.0 || ^10.0.0`，`@eslint-community/eslint-utils` 4.10.1 是 `>=8.0.0`，安装没有 peer 警告。
  - `tests/eslintPlatformRules.test.cjs` 用的 `new ESLint({ cwd })` 和 `lintText` 在 10 里不变。
- 本地验证（`gh pr checkout 135`，Node 26.13.0）：`pnpm install`、`pnpm run lint` 通过；`--format json` 显示检查了 133 个文件，和 `git ls-files` 列出的 `src/**/*.ts`、`resource/login/*.js`、`tests/**/*.cjs` 数目一致。临时在三个目录各放一个违规文件，`no-var`、`eqeqeq`、`no-empty`、`no-alert`、`prefer-const`、`@typescript-eslint/no-unused-vars`、`no-restricted-properties`、两条 `no-restricted-syntax` 和 `reportUnusedDisableDirectives` 都报错，删掉后恢复干净；`node --test tests/eslintPlatformRules.test.cjs` 12 个全过。规则确实在生效，不是配置失效后静默通过。
- 结论：不需要配合改动，可以直接合并 #135，没有开配合 PR。和 #136 改的是 `package.json`、`pnpm-lock.yaml` 的不同位置，先合哪个都行，后合的那个由 Renovate 重建（#135）或手动 rebase（#136）解决 lockfile 冲突。

## 2026-11-09 #136、#135、#137 合并，评估 #138（js-yaml 5）和 #139（Node 26）

- 2026-11-09 维护者合并 #136（`775ce3e`）、#135（`924fd54`，ESLint 10）、#137（`0277532`，冒烟测试认 Electron 45 反引号写法）。
- #134（Electron 45）：第一次重建后的运行 [`42558369750`](https://github.com/JayYa/fntv-electron/actions/runs/42558369750) 冒烟测试仍失败，因为合并基点是 `924fd54`，不含 #137。Renovate 默认只在冲突时 rebase，维护者勾 PR 正文的 rebase 复选框后重建为 `f408318`，运行 [`42562840180`](https://github.com/JayYa/fntv-electron/actions/runs/42562840180) 16 项检查全过。维护者当天没有机器手测，#134 暂不合并，手测清单见 [Electron 45 升级评估](electron-45-upgrade.md)。
- #138（js-yaml 4.3.2 → 5.5.0，head `9a8de18`）：只读评估结论是可以直接合并。js-yaml 只在 `tests/releaseGate.test.cjs`、`tests/standards.test.cjs` 里用 `load()` 读 workflow；5.x 仍支持 `require`，删掉的 `safeLoad` 等没用到，workflow 没有锚点和 `<<`。4.3.2 和 5.5.0 读 6 个 workflow 和 `pnpm-workspace.yaml` 结果一致。electron-builder 子包仍各自用 4.3.2。
- #139（Node 22 → 26，含 `@types/node` 20 → 26，head `e00bfd3`）：CI 全红，三平台 Test 和 build 都失败在 `tsc`：`src/public/platform.ts(73,51): Namespace 'path' has no exported member 'PlatformPath'`。`@types/node` 25 起删掉了 `PlatformPath`（22.20.5、24.19.2 有，25.9.9、26.6.6 没有），和 Node 26 运行时无关。
  - CI 用的 Node：26 自 2026-10-28 起是 Active LTS。在 PR head 上用 Node 26.13.0 本地跑 install（yauzl override 仍有效）、tsc、lint、test 和 Windows 打包都通过，冒烟测试没跑。
  - `@types/node`：运行时是 Electron 内置的 Node（Electron 38 是 22.22.0，45 是 24.22.2），用 26 的类型会让 tsc 放过运行时没有的 API。
  - 配合改动（本节所在 PR）：`renovate.json` 加规则，`@types/node` 的 `allowedVersions` 为 `<23`，跟随 Electron 38；`platform.ts` 的 `path.PlatformPath` 改成 `typeof path.posix`，以后升 `@types/node` 25+ 不再卡在这里。合并后等 Renovate 重建 #139，预计只剩 workflow 的 Node 26，三平台构建和冒烟测试都绿后再合并。#134 合并时把上限改成 `<25`。

## 2026-11-09 #138、#140 合并

- 2026-11-09 维护者合并 #138（`ffd2e7b`，js-yaml 5）和 #140（`7557fb3`，`@types/node` 上限 `<23`）。#140 的 CI 第 1 次尝试 Windows、macOS 因 Electron 下载 504 失败，重跑后通过；原因和改法见 [CI 下载与缓存](ci-download-cache.md)（2026-11-09 从构建依赖与 MPV 插件同步拆出）的“2026-11-09 CI Test job 的 Electron 下载改为单独步骤，带缓存和重试”。

之后各节（评估 #141 和 #142、#144 等合并、#149 合并后的依赖清理）见 [依赖更新（TypeScript 6 之后）](dependency-updates-ts6.md)。
