---
status: accepted
---

# 构建和检查脚本的约定

`scripts/` 下脚本的用途、用法和不明显的实现选择。

## `build-preload.cjs`

把 preload 打成单文件 `dest/preload/bundle.js`：主窗口开了 sandbox，preload 只能 `require('electron')`。不覆盖 tsc 输出的 `index.js`，否则 `tsc --watch` 重新输出时会盖掉打包结果。`--watch` 同时运行 `tsc --watch`。用 `platform: 'browser'`：导入 Node 内置模块在构建时就报错，不用等到运行时。

`target` 写死为 `chrome<主版本>`，等于依赖里 Electron 内置 Chrome 的主版本。不在构建时从 Electron 推导：electron 42 起二进制在第一次 `require('electron')` 时才下载，构建会因此依赖网络。升级 Electron 后 `tests/preloadBundle.test.cjs` 用 `ELECTRON_RUN_AS_NODE` 运行已安装的 Electron 取 `process.versions.chrome`，不一致时失败并给出新值。测试不读脚本源码，也不让脚本导出 `options`：用 `useFakeModule` 换掉 `esbuild` 后加载脚本，看它交给 `esbuild.build` 的 `target`。

## `check.cjs`（`pnpm run check`）

改完代码后的验证入口，本地和 CI（`ci.yml`）跑同一条命令：文件大小检查、lint、knip、测试依次运行，一步失败也接着跑后面的，最后汇总，有一步失败就以 1 退出。

- 默认文件大小检查对 `origin/main` 的合并基点：HEAD 相对合并基点改动的文件，读 HEAD 的内容；未提交的改动由 pre-commit 钩子检查。`--base <ref>` 换对比的 ref，CI 的 PR 传 `HEAD^1`（PR 合并提交的第一个父提交就是 base）。`--no-file-size` 跳过，CI 只在 Linux 那一格的 PR 上跑它。
- 所有步骤都不经 shell、参数按数组传：Windows 的 cmd 会改写参数里的空格和 `^`、`&`、`%` 等元字符（比如吞掉 `HEAD^1` 里的 `^`），不报错。PATH 上的 `pnpm` 在 Windows 上可能是 `.cmd`，只能经 shell 运行，所以不按名字找 pnpm，而是用 `pnpm run` 设置的 `npm_execpath`：JS 入口用 `process.execPath` 运行，原生可执行文件（pnpm 12 起是原生二进制，Windows 上是 `.exe`）直接运行。没有 `npm_execpath`（直接 `node scripts/check.cjs`），它的文件名不以 `pnpm` 开头（`npm run check` 时是 `npm-cli.js`，照常运行的话各步骤会悄悄改由 npm 执行），或者它在 Windows 上既不是 JS 也不是 `.exe`，在运行任何步骤前以 2 退出，提示用 `pnpm run check`，不回退到 shell。步骤显示仍写成 `pnpm …`。`tests/checkCommand.test.cjs` 把脚本复制到临时目录运行，`npm_execpath` 指向记录参数的假入口，不导出 `pnpmCommand`、`runCommand`，也不写仓库的 `check.log`。

## `check-file-size.cjs`

agent 写的文件不能超过 `MAX_TOKENS`，超过 `WARN_TOKENS` 时提醒但不拦。不受限的文件在 `.gitattributes` 标 `-agent-authored`，二进制文件跳过。默认（pre-commit）检查暂存区里新增、修改、重命名的文件，读暂存内容和暂存区的 `.gitattributes`；`--base <ref>`（CI）检查 HEAD 相对合并基点改动的文件，读 HEAD 的内容，并输出 GitHub annotation。`check-attr --source` 要求 git 2.40 及以上。

## `lint-staged.cjs`

pre-commit 钩子先跑 `check-file-size.cjs`，再跑它，两个都跑完、任一失败就拒绝提交。它对暂存区里新增、修改、重命名、且在 `package.json` 的 `lint` 脚本路径内的 `.ts/.js/.cjs/.mjs` 文件，用 ESLint 检查暂存的内容（不是工作区），所以解析错误和 lint 违规在提交时就拦下，不用等 `pnpm run check`。不跑测试：全量测试要一分多钟，留给 check 和 CI（`tests/lintStaged.test.cjs`）。

## `check-commit-message.cjs`

检查提交信息（commit-msg 钩子，读文件第一行有效内容）和 PR 标题（`-` 从 stdin 读）是否符合 Conventional Commits。git 自己生成的标题和 `rebase --autosquash` 的标记放行。

## `check-mpv-manifest.cjs`

构建期清单断言（#221，契约见 `docs/mpv-archive-contract.md`）：MPV 归档解压后、打包前读归档根目录的 `fntv-manifest.json`，清单读不出、`formatVersion` 不认识、`archiveVersion` 不等于 `mpv-archive.json` 固定的 tag、`provides` 不满足客户端的 `requires` 时构建失败。复用编译后的同步模块，所以在 `pnpm run compile` 之后运行（`build.yml`）。默认读 `third_party/fntv-mpv` 和仓库根目录的 `mpv-archive.json`，`--archive`、`--pin` 可改。

## `check-update-metadata.cjs`

electron-builder 打包后，核对 `latest*.yml` 里的安装包文件名、size 和 sha512 与输出目录里的文件一致，否则应用内更新下载后校验不过（ADR-0003）。每个问题输出一条 `::error::`。

## `ci-download-cache.cjs`

CI 的 Electron 下载缓存。key 只取 `package.json` 里的版本号，安装依赖之前也能算出来；Electron zip 只对一种架构有用，key 带架构。缓存目录是 `@electron/get` 不传 `cacheRoot` 时的默认目录（`env-paths('electron').cache`），和 app-builder-lib 的 `defaultElectronGetCacheRoot` 相同。`@electron/get` 即使命中缓存，也每次联网下载 `SHASUMS256.txt` 校验，GitHub 504 时打包照样失败；app-builder-lib 26.18.0 会读缓存根目录下的 `SHASUMS256.txt-<版本>` 离线校验，所以打包前用 electron 包自带的 `checksums.json` 写这份文件。

## CI 安装依赖和 workflow 的约定

- `ci.yml` 和 `build.yml` 共用 composite action `.github/actions/install-dependencies`：两份各写一遍时 `build.yml` 漏改过一次（#143 只改了 `ci.yml`），Renovate PR #139 的构建因此失败。
- Electron 二进制由安装依赖之后的单独步骤（`node node_modules/electron/install.js`）带缓存和重试下载（2026-11-09，PR #140、#139 遇到 504）。electron 42 起没有安装脚本，`index.js` 在二进制不在时自己运行 `install.js` 下载，只试一次，不重试；预先下载让测试和打包不走这条路径。electron 42 起也不读 `ELECTRON_SKIP_BINARY_DOWNLOAD`。electron 包重新加回安装脚本或去掉 `install.js` 时 `tests/ciElectronDownload.test.cjs` 失败，提醒重新核对下载步骤。下载步骤设 `DEBUG=@electron/get:*`，日志里能看到 `Cache hit` / `Cache miss`。
- `pnpm test` 在 `node --test` 之前也运行一次 `install.js`（#314）：测试文件各在一个进程里并行跑，几个进程同时 `require('electron')` 时各自解压到同一个 `dist`，Windows 上先解压完的进程启动 `electron.exe` 时别的进程还在写，报 `EBUSY`。二进制已装好时 `install.js` 立即退出，不联网。
- Electron 下载缓存是单步 `actions/cache`，job 结束时由 post 步骤保存（2026-11-14），key 见上文 `ci-download-cache.cjs`。
- composite action 的步骤不支持 `timeout-minutes`，写了也不生效；其中的 `run` 步骤必须写 `shell`，Windows 上 bash 语法也靠它。
- 第三方 action 固定到 commit SHA；本仓库的 action 和可复用 workflow 随提交一起变，不固定 SHA，但文件必须存在。
- 提交信息、PR 标题、分支名可以带 shell 语法，直接展开进 `run` 会被执行，所以先放进 `env:`，再用 `"$VAR"` 读。
- `ci.yml` 对任何 base 分支的 PR 都跑：堆叠 PR 的 base 不是 `main`。
- `tests/standards.test.cjs` 运行文档里的“验证：”命令：grep 和 git grep 用退出码 0 和 1 表示有无结果，其它退出码说明命令本身坏了。Windows 上 PATH 里的 bash 可能是 WSL，所以用 Git 自带的。文档写“`<文件>.yml` 的 `<名字>`”时，名字是那个 workflow 的触发事件、job id 或 step 的 name，测试核对它存在。
- 同一文件还核对 electron 的二进制解压完整：解压完才写 `path.txt`，曾经解压器在 Node 26 上读不出 zip 内容却以 0 退出，`dist` 里只剩空的 `locales`。按需下载时 `index.js` 先往 stdout 打下载信息，可执行文件路径在最后一行。

## CI 缓存和下载的来由

- `build.yml` 的打包命令遇到下载错误时整体重跑（2026-11-09，Renovate PR #139 遇到 504）。
- 打包下载缓存（`packaging-*`）和预热它的 `cache-warm.yml` 在 2026-11-14 删掉：run 43585290276 对比 43560322186，不命中只多 10 到 14 秒。只留 `install-dependencies` 的 Electron 下载缓存和 MPV 归档缓存。
- `ci-download-cache.cjs` 写的 `SHASUMS256.txt-<版本>` 每行是 `<sha256> *<文件名>`，这是 app-builder-lib 的 `parseChecksumFile` 认的格式。Electron key 从仓库自己的 `package.json` 算得出来，因为 Renovate 的 `rangeStrategy` 是 `pin`，版本号是精确值。
- MPV 归档按 sha256 缓存：换版本时 key 跟着变，命中缓存也要校验，不通过就重新下载。恢复和保存分成两步，后面的构建失败也保住已下载的压缩包。保存只在未命中时运行，紧跟在产生缓存内容的步骤后面；两步都不能让构建失败（`tests/helpers/workflowSteps.cjs` 的 `assertRestoreAndSave`）。
- `ci.yml` 也在 push 到 `main` 时跑：PR #207 和 #209 各自的 CI 都通过，合在一起后 `main` 上 7 项测试失败，到 #210 才发现（2026-11-14）。push 上没有 PR 的 base 提交，文件大小检查只在 PR 上跑，由 `test` job 的 `Run checks` 按事件开关。`main` 上的 pnpm store 和 Electron 下载缓存由 push 到 `main` 的 `ci.yml` 存；`cache-cleanup.yml` 在 PR 关闭时删掉这个 PR 的缓存（2026-11-10）。
- `update-mpv-archive.yml` 定时加手动触发，只从 `main` 运行，tag 经 `env` 传给脚本，用 GITHUB_TOKEN 开 PR。改的文件都不在 `.github/workflows` 下：GITHUB_TOKEN 推不了改 workflow 的提交（2026-11-14 实际失败过）。远端分支上三处文件已经一样时不推：每次推送都要维护者重新批准 CI。PR 改了这些文件时 Smoke Test（`smoke-test.yml`）也会触发，升级 PR 因此用新归档构建并测试安装包。

## `install-smoke-deps.cjs`

冒烟测试 job 只装 `tests/smoke/` 用到的 npm 包，不跑完整的 `pnpm install`。版本和 integrity 取自 `pnpm-lock.yaml`，从 registry 下载锁定版本的 tarball，核对 sha512 后解压；只接受锁文件里没有依赖的包，`package.json` 里写的版本必须是锁文件里那个。不读 `.npmrc`（CI 上已删掉），本地要用镜像时设 `npm_config_registry`。临时目录放在 `node_modules` 下、和目标同盘：Git 自带的 GNU tar 把 `D:\…` 这样的盘符路径当成远程主机，只能给相对路径。

## `smoke-unpackaged.cjs`

用 `node_modules` 里的 Electron 启动仓库（`electron .`），跑 `tests/smoke/installer.smoke.cjs` 的同一套断言，只对安装包成立的几条跳过。要先编译：CI 在 `pnpm run check` 之后跑，本地用 `pnpm run test:smoke:unpackaged`。Linux 没有显示器时套 `xvfb-run`。产物写到 `smoke-artifacts/unpackaged-<平台>-<架构>/`，`FNTV_SMOKE_ARTIFACTS` 可改。固定 spec reporter，`::notice::` 注解才不会被加上 `# ` 前缀。

## `update-mpv-archive.cjs`

把构建固定的 MPV 归档换成 `JayYa/fntv-mpv-config` 的另一个 Release，定时 workflow（`update-mpv-archive.yml`）和手工升级共用。改 `mpv-archive.json`（唯一来源：`{ repo, tag, asset, sha256 }`）、`README.md` 准备步骤和 `docs/external-runtime.md` 里的 tag，三处一致由 `tests/mpvArchiveCache.test.cjs` 把关；先算好三个文件的新内容，全部成功才写。不改 `.github/workflows`：GITHUB_TOKEN 推不了改 workflow 的提交。资产名和 sha256 只取 Release API 给的（Release 里恰好一个 `.zip`，sha256 用资产的 digest），不下载归档；资产名会进构建的环境变量和下载地址，只收安全字符。不带参数时取最新正式 Release，tag 更新才改；`--tag <tag>` 取指定 Release，不比较新旧，也用于回滚。设了 `GITHUB_OUTPUT` 时写 `updated`、`previous-tag`、`tag`、`asset`、`sha256`。

## `update-comment-baseline.cjs`

见 ADR-0007。
