---
status: accepted
---

# 构建和检查脚本的约定

`scripts/` 下脚本的用途、用法和不明显的实现选择。

## `build-preload.cjs`

把 preload 打成单文件 `dest/preload/bundle.js`：主窗口开了 sandbox，preload 只能 `require('electron')`。不覆盖 tsc 输出的 `index.js`，否则 `tsc --watch` 重新输出时会盖掉打包结果。`--watch` 同时运行 `tsc --watch`。用 `platform: 'browser'`：导入 Node 内置模块在构建时就报错，不用等到运行时。

## `check.cjs`（`pnpm run check`）

改完代码后的验证入口，本地和 CI（`ci.yml`）跑同一条命令：文件大小检查、lint、knip、测试依次运行，一步失败也接着跑后面的，最后汇总，有一步失败就以 1 退出。

- 默认文件大小检查对 `origin/main` 的合并基点：HEAD 相对合并基点改动的文件，读 HEAD 的内容；未提交的改动由 pre-commit 钩子检查。`--base <ref>` 换对比的 ref，CI 的 PR 传 `HEAD^1`（PR 合并提交的第一个父提交就是 base）。`--no-file-size` 跳过，CI 只在 Linux 那一格的 PR 上跑它。
- node 直接运行、不经 shell：Windows 的 cmd 会吞掉 `HEAD^1` 里的 `^`。Windows 上 `pnpm` 是 `.cmd`，只能经 shell 运行。

## `check-file-size.cjs`

agent 写的文件不能超过 `MAX_TOKENS`，超过 `WARN_TOKENS` 时提醒但不拦。不受限的文件在 `.gitattributes` 标 `-agent-authored`，二进制文件跳过。默认（pre-commit）检查暂存区里新增、修改、重命名的文件，读暂存内容和暂存区的 `.gitattributes`；`--base <ref>`（CI）检查 HEAD 相对合并基点改动的文件，读 HEAD 的内容，并输出 GitHub annotation。`check-attr --source` 要求 git 2.40 及以上。

## `check-commit-message.cjs`

检查提交信息（commit-msg 钩子，读文件第一行有效内容）和 PR 标题（`-` 从 stdin 读）是否符合 Conventional Commits。git 自己生成的标题和 `rebase --autosquash` 的标记放行。

## `check-mpv-manifest.cjs`

构建期清单断言（#221，契约见 `docs/mpv-archive-contract.md`）：MPV 归档解压后、打包前读归档根目录的 `fntv-manifest.json`，清单读不出、`formatVersion` 不认识、`archiveVersion` 不等于 `mpv-archive.json` 固定的 tag、`provides` 不满足客户端的 `requires` 时构建失败。复用编译后的同步模块，所以在 `pnpm run compile` 之后运行（`build.yml`）。默认读 `third_party/fntv-mpv` 和仓库根目录的 `mpv-archive.json`，`--archive`、`--pin` 可改。

## `check-update-metadata.cjs`

electron-builder 打包后，核对 `latest*.yml` 里的安装包文件名、size 和 sha512 与输出目录里的文件一致，否则应用内更新下载后校验不过（ADR-0003）。每个问题输出一条 `::error::`。

## `ci-download-cache.cjs`

CI 的 Electron 下载缓存。key 只取 `package.json` 里的版本号，安装依赖之前也能算出来；Electron zip 只对一种架构有用，key 带架构。缓存目录是 `@electron/get` 不传 `cacheRoot` 时的默认目录（`env-paths('electron').cache`），和 app-builder-lib 的 `defaultElectronGetCacheRoot` 相同。`@electron/get` 即使命中缓存，也每次联网下载 `SHASUMS256.txt` 校验，GitHub 504 时打包照样失败；app-builder-lib 26.18.0 会读缓存根目录下的 `SHASUMS256.txt-<版本>` 离线校验，所以打包前用 electron 包自带的 `checksums.json` 写这份文件。

## `install-smoke-deps.cjs`

冒烟测试 job 只装 `tests/smoke/` 用到的 npm 包，不跑完整的 `pnpm install`。版本和 integrity 取自 `pnpm-lock.yaml`，从 registry 下载锁定版本的 tarball，核对 sha512 后解压；只接受锁文件里没有依赖的包，`package.json` 里写的版本必须是锁文件里那个。不读 `.npmrc`（CI 上已删掉），本地要用镜像时设 `npm_config_registry`。临时目录放在 `node_modules` 下、和目标同盘：Git 自带的 GNU tar 把 `D:\…` 这样的盘符路径当成远程主机，只能给相对路径。

## `smoke-unpackaged.cjs`

用 `node_modules` 里的 Electron 启动仓库（`electron .`），跑 `tests/smoke/installer.smoke.cjs` 的同一套断言，只对安装包成立的几条跳过。要先编译：CI 在 `pnpm run check` 之后跑，本地用 `pnpm run test:smoke:unpackaged`。Linux 没有显示器时套 `xvfb-run`。产物写到 `smoke-artifacts/unpackaged-<平台>-<架构>/`，`FNTV_SMOKE_ARTIFACTS` 可改。固定 spec reporter，`::notice::` 注解才不会被加上 `# ` 前缀。

## `update-mpv-archive.cjs`

把构建固定的 MPV 归档换成 `JayYa/fntv-mpv-config` 的另一个 Release，定时 workflow（`update-mpv-archive.yml`）和手工升级共用。改 `mpv-archive.json`（唯一来源：`{ repo, tag, asset, sha256 }`）、`README.md` 准备步骤和 `docs/external-runtime.md` 里的 tag，三处一致由 `tests/mpvArchiveCache.test.cjs` 把关；先算好三个文件的新内容，全部成功才写。不改 `.github/workflows`：GITHUB_TOKEN 推不了改 workflow 的提交。资产名和 sha256 只取 Release API 给的（Release 里恰好一个 `.zip`，sha256 用资产的 digest），不下载归档；资产名会进构建的环境变量和下载地址，只收安全字符。不带参数时取最新正式 Release，tag 更新才改；`--tag <tag>` 取指定 Release，不比较新旧，也用于回滚。设了 `GITHUB_OUTPUT` 时写 `updated`、`previous-tag`、`tag`、`asset`、`sha256`。

## `update-comment-baseline.cjs`

见 ADR-0007。
