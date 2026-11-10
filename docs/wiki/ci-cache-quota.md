# CI 缓存额度与清理

2026-11-10 起的 CI 缓存记录。[CI 下载与缓存](ci-download-cache.md) 接近提交钩子的 20000 字节上限，之后的记录写在这里。

相关：[CI 下载与缓存](ci-download-cache.md)（#101、#143、#146、#149：下载缓存、key、`cache-warm.yml` 的由来）、[依赖更新（TypeScript 6 之后）](dependency-updates-ts6.md)。

## 2026-11-09 调研：缓存超限的来源（只读，`2d0bdaa`）

2026-11-09 约 13:10Z 只读调研了缓存列表、最近 60 次运行和 11 个 job 的完整日志，没有改仓库、删缓存或触发 workflow。下面是后面决定用到的数字。

- 总量：`actions/cache/usage` 报 95 条、11,214,887,462 B（10.44 GiB），超出 10 GiB 上限。按 ref 分：main 2.78 GiB，`refs/pull/<N>/merge` 7.36 GiB，分支 `fix/mpv-ipc-hardening` 0.31 GiB。超限后 GitHub 按最近访问时间淘汰，当时最先被淘汰的是 PR 上的缓存，但余量很小，一次 Electron 或锁文件升级就可能挤掉 main 上有用的缓存。
- PR 缓存全是死数据：缓存所在的 PR（#134 关闭，#139、#141、#144、#147 至 #151 合并）都已结束，以后不会被读到。PR 缓存只有这个 PR 自己的运行读得到，PR 关闭后要等 7 天没被读才被清掉。
- main 上的旧版本：Electron 38.8.6 的 `electron-<os>-38.8.6` 和 `packaging-<os>-electron-38.8.6-…` 共 6 条、990 MB，升级到 45 后不会再被读到，但 `cache-warm.yml` 只存不删。
- main 上的 Go 和 pnpm store 缓存不更新：`cache-warm.yml` 只在 `electron-*`、`packaging-*` 的 key 缺失时构建，这两个 key 只随 Electron、electron-builder 版本变。#150（`8812550`）改了 `go.sum` 和锁文件后，main 上留着旧 key（`setup-go-…-191b5caf…`、`node-cache-…-58c9e1d7…`），之后每个 PR 都拿不到 Go 缓存：`Run Go tests` 从 5–14 s 变成 29–42 s，Windows 的 `Post Setup Go` 保存要 43 s（CI `42621613729`），每个 PR 再各存约 310 MB Go 缓存和 200–400 MB pnpm store。CI 的墙钟由 Windows job 决定，从约 2:30 变成约 3:30。
- 打包缓存重复存了宿主架构的 Electron zip：`electron-<os>`（install-dependencies 存）和 `packaging-<os>-…` 里都有宿主 zip（Windows x64、Linux x64、macOS arm64）。45.2.3 的恢复大小：Windows packaging 166,429,342 B，其中约 150 MB 是 `electron-Windows-45.2.3` 里那个 zip，工具只有约 8 MB；Linux 256,943,305 B；macOS 314,346,322 B。每个版本组合在 main 上多占约 385 MB，每次构建多下载同样大小。
- 同一 PR 的过时 CI 运行不取消：#151 的 `42619787265` 和 `42619844266` 相隔 26 s，前者照样跑完（3 个 job 共 291 s）。

## 2026-11-10 手动删除已关闭 PR 的缓存

- 当天缓存总量 10.44 GiB，仍超上限。维护者批准后删除 58 条已关闭 PR 的缓存（6.27 GiB），删后 main 上 28 条、3.46 GiB。没有改代码。
- `refs/heads/fix/mpv-ipc-hardening` 上 4 条、0.31 GiB（`workflow_dispatch` 冒烟运行 `42620438769` 存的 pnpm store）没删：删除被权限拦下。
- 这次只删 PR 上的缓存。main 上的旧版本缓存由下一节的 `prune` 在合并后删除。

## 2026-11-10 自动清理缓存，main 上的依赖缓存跟着更新（本节所在 PR）

维护者当天同意把下面五项合成一个 PR。macOS 构建去掉 `Setup Python` 另有人做，不在这个 PR。

- PR 关闭时删缓存：新增 `cache-cleanup.yml`，`pull_request` 的 `closed`（合并也是 closed），job 单独给 `actions: write`，用 `gh api` 列出 `refs/pull/<编号>/merge` 上的缓存逐条删除。不 checkout。fork 来的 PR 拿到的 token 只读，删不了，用 `if` 跳过；没用 `pull_request_target`。
- 删掉 main 上被取代的旧版本：`cache-warm.yml` 新增 `prune` job，在 `warm` 之后跑（`warm` 跳过或部分失败也跑），列出 main 上的缓存，按 `scripts/ci-download-cache.cjs stale` 删除。规则：同一平台的当前 Electron key 已在 main 上时，才删其它 `electron-<os>-*`；当前打包 key 已在时，才删其它 `packaging-v2-<os>-*` 和换前缀之前的 `packaging-<os>-*`。先存后删，因为新打包 key 第一次构建要经 `restore-keys` 从旧 key 拿打包工具；新 key 没存成时旧的不删。`mpv-archive-*`、`setup-go`、`node-cache` 不动。合并后 `cache-warm.yml` 会因为改了自己而运行，main 上还在的 38.8.6 缓存和旧前缀的打包缓存在那时删掉。
- main 上的 Go 和 pnpm store 缓存：`cache-warm.yml` 新增 `deps` job，三平台只做 checkout、`Setup pnpm`、`Setup Node.js`（`cache: pnpm`）、`Setup Go`、`pnpm install --frozen-lockfile` 和 `go test -run '^$' ./...`（编译代码和测试，不运行），由 action 的 post 步骤在 main 上存缓存，key 已在时不存。不预先算 key：key 的格式由 action 决定，三个 setup 步骤和 `ci.yml` 写得一样，key 就一样（`tests/cacheWarm.test.cjs` 核对）。`push.paths` 加上 `src/modules/proxy/go.mod`、`go.sum`。仍不给 `ci.yml` 加 `push: main`（2026-11-09 的决定，见 [CI 下载与缓存](ci-download-cache.md)）：这个 job 不跑测试全集，不打包。
- `ci.yml` 加 `concurrency`：组名 `ci-${{ github.ref }}`，`cancel-in-progress: true`。`pull_request` 上 `github.ref` 是 `refs/pull/<编号>/merge`，每个 PR 一组；`ci-` 前缀不和 `smoke-test-`、`cache-warm-`、`release-` 相撞。
- 打包缓存不再存宿主架构的 zip：`build.yml` 的打包缓存路径从三个 `@electron/get` 默认目录改为只列另一个架构的 zip：`~/.cache/electron/**/electron-v*-linux-arm64.zip`、`~/Library/Caches/electron/**/electron-v*-darwin-x64.zip`；Windows 只打 x64，打包缓存里只剩打包工具。没用 `!` 排除：actions/toolkit 的 `cache` 包用 `implicitDescendants: false` 匹配路径，再 `tar --files-from`，匹配到目录时整个目录进 tar，排除不了目录里的文件（2026-11-10 读 `packages/cache/src/internal/cacheUtils.ts` 的 `resolvePaths` 和 `tar.ts`）。路径变了，actions/cache 的 version 跟着变，旧 key 读不到，所以 key 前缀换成 `packaging-v2-<os>-`。runner 换架构（例如 `macos-latest` 改成 x64）时要跟着改路径，否则那个 zip 每次重新下载，打包仍有外层重试。
- 测试：`tests/buildDownloads.test.cjs` 改为核对新路径和 `packaging-v2-` 前缀；`cache-warm.yml` 的测试移到新文件 `tests/cacheWarm.test.cjs`，新增 `stale` 规则、`prune` 和 `cache-cleanup.yml` 的删除步骤（桩 `gh`）、`deps` 和 `ci.yml` 的 setup 步骤一致、`ci.yml` 的 `concurrency`。两个文件共用的临时项目和桩命令移到 `tests/helpers/ciCache.cjs`。
- 合并前没验证的：`prune`、`deps` 只能在 main 上跑，`cache-cleanup.yml` 要等 PR 关闭；新打包缓存的大小和 PR 是否命中 `deps` 存的 key，要看合并后的运行。
