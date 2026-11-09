# 依赖更新（TypeScript 6 之后）

2026-11-09 从 [依赖更新（Renovate）](dependency-updates.md) 拆出，原因是原文件接近提交钩子的 20000 字节上限。移来的是“评估 #141 和 #142”“#144、#147、#141、#139 合并”两节，原文未改；末节是拆分时新写的。节内“上一节”指本页的节。

相关：[依赖更新（Renovate）](dependency-updates.md)、[Electron 45 升级评估](electron-45-upgrade.md)、[CI 下载与缓存](ci-download-cache.md)。

## 2026-11-09 评估 #141（rimraf 6）和 #142（TypeScript 7），维护者选择先停在 TS 6

- #141（rimraf 5.0.10 → 6.1.4，评估时 head `0d155b7`，基于 `0277532`）：只读评估结论是可以直接合并，不需要配合改动。
  - CI 失败都在 `pnpm install --frozen-lockfile` 的 Electron 下载 504，和 rimraf 无关。
  - 6.x 要求 Node `20 || >=22`，三个 workflow 用 `22.23.4`；rimraf 只在构建时作 CLI 用，不进应用包。CLI 没删选项，本项目也不用 `--glob`。
  - 只有 `package.json` 的 `clean`（`rimraf dest`）和 `clean:proxy:mac` 两处用到。在 PR head 上本地验证了这两个脚本（目录或文件存在时删除，不存在时退出码 0），`tsc --noEmit`、`pnpm run lint`、`pnpm test` 也都通过。
  - 评估之后 Renovate 把 #141 重建为 `ef2b9bc`。
- #142（typescript 5.9.3 → 7.0.2，head `1e825b4`，基于 `0277532`）：不能合并，重跑解决不了。
  - lint：`typescript-eslint` 8.72.1 及 `@typescript-eslint/*` 的 peer 是 `typescript >=4.8.4 <6.1.0`。TS 7.0 不提供 JS API（`require('typescript')` 只导出 `version`、`versionMajorMinor`），parser 启动就报 `typescript-eslint does not support TS 7.0.`，`tests/eslintPlatformRules.test.cjs` 也跟着失败。上游支持状态见 typescript-eslint#10940（open，WIP 针对 7.1 的新 API）。
  - `tsc`：7.0 把 6.0 弃用的选项改成错误。`tsconfig.json` 的 `baseUrl` 报 TS5102，`paths` 的非相对路径报 TS5090，没写 `rootDir` 时 emit 报 TS5011。另外 `types` 默认改为 `[]`：不报错，但不再自动加载 `node_modules/@types` 下的包。
  - `pnpm run watch`：TS 7 的 `exports` 不导出 `./bin/tsc`，`scripts/build-preload.cjs` 的 `require.resolve('typescript/bin/tsc')` 报 `ERR_PACKAGE_PATH_NOT_EXPORTED`。CI 不跑 watch，所以 CI 里看不到。
  - 两个方案：A. 先停在 TS 6，等 typescript-eslint 支持 TS 7 再升；B. 按官方并存方案用 TS 7 编译，再把 `typescript` 别名到 `@typescript/typescript6` 给 typescript-eslint 用。B 在本地验证通过，代价是同时维护两套 TypeScript。
- 2026-11-09 维护者选了方案 A。配合改动（本节所在 PR）：
  - `tsconfig.json`：删掉 `baseUrl`、`paths`（`src` 里没有 `@/` 导入，是死配置），加 `rootDir: "./src"`，`typeRoots` 改成 `types: ["node"]`。TS 5.9.3 下 `dest/` 与改前逐字节相同（`.tsbuildinfo` 除外）；`tsc --noEmit`、`pnpm run lint`、`pnpm test`（355 通过，1 跳过）通过，`pnpm run watch` 正常启动。
  - `renovate.json`：`typescript` 的 `allowedVersions` 设为 `<6.1.0`。取 typescript-eslint 8.72.1 的 peer 上限，不用笼统的 `<7`，否则 Renovate 还会开出 lint 不支持的 6.1。typescript-eslint 支持 TS 7 后放开；它的 peer 上限提高但仍不含 7 时，跟着改。
  - 合并后 #142 由维护者关闭，或等 Renovate 按新规则处理。

## 2026-11-09 #144、#147、#141、#139 合并，剩 #134 和 #132

- 上一节的配合改动是 #145（`7a538c4`）。#145 合并后 Renovate 关闭了 #142，按 `<6.1.0` 的限制换开 #147（TypeScript 6）。
- 维护者依次合并 #144（`2c8f04b`，`@types/node` 22）、#147（`a23cbb4`，TypeScript 6）、#141（`4fe1c1f`，rimraf 6）、#139（`d5091bc`，CI 的 Node 26）。这几个 PR 重建后的 CI 和冒烟测试都复用了 main 上预热的下载缓存，见 [CI 下载与缓存](ci-download-cache.md) 的“2026-11-09 #146 合并后验证”。
- 截至 `d5091bc` 还开着：
  - #134（Electron 45）：CI 全绿，等维护者手测（清单见 [Electron 45 升级评估](electron-45-upgrade.md)）。合并时把 `renovate.json` 里 `@types/node` 的 `allowedVersions` 改成 `<25`。
  - #132（release 2.8.1）：维护者决定这批更新之后再发。

## 2026-11-09 #149 合并，Abandoned 依赖调查，删除和替换不需要的依赖

- #149 合并为 `efa66c2`（`feat(deps)!: 升级 Electron 到 45，macOS 最低版本改为 13（Ventura）`），#134 随后关闭。#132 跟着变成 release 3.0.0。
- 决定（维护者，当天）：PR 标题写明 macOS 最低版本。仓库 squash 设置是 PR 标题加空正文，PR 正文和分支提交里的 `BREAKING CHANGE` 都不进 `main`，release-please 生成更新说明只看得到标题，用户只能从标题知道 macOS 12 不再支持。
- Abandoned 依赖调查（Dependency Dashboard #128 列的 4 个包，基于 `efa66c2`，只读）：
  - `copyfiles`：没有任何地方用到，`ce2f313` 换掉 `esbuild-copy-static-files` 后就没调用过。删除。
  - `cross-env`：只在 `build:proxy:linux:*` 两个脚本里用，这两个脚本只在 Linux runner 上跑，sh 本来就支持 `GOOS=... go build`；mac 的 4 个脚本已经这样写。删除，改成同样写法。代价是 Windows 上不能直接 `pnpm run build:proxy:linux:*`，要在 Git Bash 里跑。cross-env 本身 2025-09 还发过版，删它是因为用不着。
  - `node-cache`：只有 `ApiService` 用 `get`、`set`（可单独给 TTL）、`del` 和默认 TTL 300 秒，换成 Map 加 TTL 的小实现。
  - `node-mpv-2`：保留，先做低成本加固，见另一个加固 PR，这里不展开。
  - 其余依赖逐个核实都有用；`src/modules/proxy` 没有未使用的直接依赖，`go mod tidy` 只删两个 indirect。
- 本节所在 PR（`chore(deps): 删除 copyfiles、cross-env、node-cache，CI 检查未使用的依赖`）：
  - 删 `copyfiles`、`cross-env`、`node-cache`；`build:proxy:linux:x64`、`:arm64` 改成 `GOOS=linux GOARCH=... go build`。CI 的 Linux 构建经 `build.yml` 的 `Build application`（bash）调用 `build:linux`，再走到这两个脚本。
  - `src/modules/fn_api/ttlCache.ts` 替代 node-cache，`tests/ttlCache.test.cjs` 用注入的时钟测。保持的语义：不传 TTL 用默认值，TTL 为 0 不过期，到期那一毫秒仍能读到。不同处：不拷贝值（唯一调用方只读字段）；没有定时清理，`get` 时删读到的过期条目，`set` 时清全部过期条目。`createCachedFunction` 未改：进行中的请求 Promise 存 30 秒合并并发请求，Promise reject 时删掉、不缓存；`request()` resolve 的 `{ success: false }` 仍按结果缓存，和原来一样。
  - `src/modules/proxy` 跑 `go mod tidy`：`go.mod` 删 `cloudwego/iasm`、`gopkg.in/yaml.v3` 两个 indirect，`go.sum` 删旧版本校验和、补测试依赖的条目。
  - CI 防回归：`ci.yml` 加 `Check unused dependencies`（`pnpm run knip`，`knip` 6.44.1 精确 pin；6.44.2 发布不满 Renovate 的 3 天）和 `Check Go modules are tidy`（`go mod tidy -diff`，CI 的 Go 版本取 `go.mod` 的 1.26）。`knip.jsonc` 只开 `dependencies`、`devDependencies`、`unlisted`、`binaries`、`unresolved`，`src` 等目录的文件都当入口（插件按目录动态加载），`go`、`lipo` 放进 `ignoreBinaries`。scripts 里作 CLI 用的 `rimraf` 等 knip 能识别，不用另配。本地把 `copyfiles`、`node-cache` 加回去、在 `src` 里导入没声明的包，knip 都报错退出。`tests/standards.test.cjs` 检查这两步和 knip 的 pin，`CODING_STANDARDS.md` 的“依赖”加一条。
