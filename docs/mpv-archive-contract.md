# MPV 归档契约

`JayYa/fntv-mpv-config` 产出的 MPV 归档和客户端之间的约定：客户端依赖归档里的什么、哪些东西不能动。改归档时按文末的检查项核对。客户端按清单同步用户配置的规则见 [external-runtime.md 的“用户配置同步”](external-runtime.md#用户配置同步)。决策原因见 [ADR-0005](adr/0005-mpv-archive-manifest-sync.md)，需求见 spec #219，术语见 [GLOSSARY.md](../GLOSSARY.md)。

## 归档里客户端依赖的路径

路径相对 MPV 归档根目录（构建时解压到 `third_party/fntv-mpv`）。改名、移动或删除下面任何一项，都要先改客户端。

| 路径 | 谁用 | 说明 |
| --- | --- | --- |
| `fntv-manifest.json` | 同步、构建期断言、启动时能力检查 | 清单，格式见下文。macOS/Linux 的安装包只带便携配置和它（`package.json` 的 `extraFiles`，两处），位置不变 |
| `portable_config/` | 同步 | 便携配置，同步的来源（`resolvePortableConfigDir`） |
| `mpv.exe` | Windows 播放 | 附带 MPV，只在 Windows 安装包里 |
| `portable_config/mpv.conf` | MPV | 薄文件，见“`mpv.conf` 分层” |
| `portable_config/fntv/defaults.conf` | MPV | 默认值，写在 `[fntv-defaults]` 段里，由 `mpv.conf` include 后用 `profile=fntv-defaults` 应用 |
| `portable_config/scripts/uosc_danmaku/main.lua` | MPV | 弹幕插件入口。同步不单独检查它，按清单把 `scripts/uosc_danmaku` 整目录托管 |
| `portable_config/scripts/smart_skip/` | MPV 播放时 | 片头片尾跳过，依赖下文的能力 `smart-skip.origin-from-play-url` |
| `portable_config/danmaku-history.json` | 弹幕插件 | 弹幕历史的种子。fntv-mpv-config 打包时把 `custom_config/<组件>/` 下的文件铺到便携配置根下，所以它在根目录 |

用户配置里这些名字归客户端，归档里不能出现同名文件：`fntv/installed.json`（安装记录）、根目录下的 `.fntv-sync-*`（暂存目录）、`<文件>.fntv-new`（待合并更新）。

归档也不能带 `script-opts/smart_skip.conf`：smart_skip 运行时自己写这个文件，归档带上它就会变成用户可改文件，和运行时写入的内容冲突。

## 清单

文件名 `fntv-manifest.json`，放在归档根目录，由 fntv-mpv-config 打包时生成，打包后的契约测试校验它和 zip 内容一致。字段名是契约：

```ts
interface FntvManifest {
  formatVersion: 1;                   // 整数，见下文
  archiveVersion: string;             // 归档 tag，例如 fntv-mpv-v20261110_224319
  mpvMinVersion?: string;             // 只作说明，客户端不检查
  components: Record<string, string>; // 组件名 -> 版本，来自 package_cfg.json
  provides: Record<string, number>;   // 能力名 -> 版本
  managedDirs: string[];              // 整目录托管、整体替换的目录
  files: Array<{
    path: string;                     // 相对便携配置，正斜杠
    sha256: string;
    role: 'managed' | 'config' | 'seed';
    knownHashes: string[];            // 这个路径的历史哈希，含本次
  }>;
  obsolete: Array<{ path: string; knownHashes: string[] }>; // 以前发过、现在删掉的托管文件
}
```

- `files` 和 `portable_config` 下的文件一一对应，不多不少。
- `managedDirs` 至少有 `scripts/uosc`、`scripts/uosc_danmaku`、`scripts/smart_skip`。目录下每个文件也要出现在 `files` 里，`role` 为 `managed`。
- 历史哈希只覆盖本 fork 发过的归档：`fntv-mpv-v20260826_013404`、`fntv-mpv-v20261108_203006`、`fntv-mpv-v20261108_233327`、`fntv-mpv-v20261110_224319`、`fntv-mpv-v20261114_223600`，以及之后每一次打包。不收录上游 QiaoKes 的归档。历史哈希只增不减，契约测试检查新清单包含上一版清单的全部哈希。
- 删掉一个托管文件时，把它连同全部历史哈希移到 `obsolete`：没有安装记录的老用户只能凭它清掉这个文件。

| `role` | 范围 |
| --- | --- |
| `managed`（托管文件） | `scripts/**`、`fonts/**`、`shaders/**`、`fntv/defaults.conf` |
| `config`（用户可改文件） | `mpv.conf`、`input.conf`、`script-opts/*.conf` |
| `seed`（种子文件） | `danmaku-history.json` |

### `formatVersion`

`formatVersion` 是同步规则的版本，不是归档的版本。客户端遇到不认识的版本时什么都不改：用错误的规则改用户配置比不改更糟。

- 改了已有字段的含义，或者加了旧客户端不懂就会改错用户配置的规则，才升版本。加一个旧客户端忽略也不会改错的字段，不升。
- 升版本前，先发认识新版本的客户端；否则还没升级客户端的用户一个文件都同步不到。

## `mpv.conf` 分层

`input.conf` 和 `script-opts` 不分层：mpv 和 `mp.options` 都只读一个文件，没有 include。只有 `mpv.conf` 分层：

- `fntv/defaults.conf` 是托管文件，全部默认值写在它的 `[fntv-defaults]` 段里，段外没有设置。改默认值只改它。
- `mpv.conf` 是用户可改文件，前两个有效行依次是 `include="~~/fntv/defaults.conf"` 和 `profile=fntv-defaults`，在第一个 `[profile]` 段之前，其余只有注释，说明“自己的设置写在这两行后面”。用户的设置写在后面，覆盖默认值，没改过 `mpv.conf` 的用户以后不会再有冲突。客户端写给老用户的 `mpv.conf.fntv-new` 就是归档里的这个文件。
- fntv-mpv-config 的契约测试检查这几条。

依据（`include` 的读法来自 mpv master `bb4823e`；生效顺序是 fntv-mpv-config#7 在附带 MPV `v0.42.0-5-g55d3feb45` 上实测的）：

- 配置文件逐行解析（`options/parse_configfile.c`），顶层的选项先存进 default profile，读完整个文件才按顺序应用。`include` 是特殊选项，应用到它时才读目标文件（`options/m_config_frontend.c` 的 include 分支调 `player/main.c` 的 `cfg_include`），目标文件的顶层选项追加到 default profile 末尾，排在外层文件所有行之后。所以默认值如果写在 `defaults.conf` 顶层，会反过来覆盖 `mpv.conf` 里用户的设置。
- 默认值放进 `[fntv-defaults]` 段，`mpv.conf` 在 include 后用 `profile=fntv-defaults` 应用：这一行应用时默认值立即生效，后面用户的设置再覆盖它们。实测日志（`mpv.conf` 末尾加 `osd-duration=5000`，`defaults.conf` 里是 2000）：先 `Applying profile 'fntv-defaults'...`、`osd-duration = 2000`，再 `osd-duration = 5000`，生效值 5000。
- 路径经 `mp_get_user_path` 展开：`~~/` 是 MPV 配置目录；不带前缀的相对路径按进程当前目录算，换个工作目录启动就找不到。
- 被 include 的文件不存在时不报错（`m_config_parse_config_file` 返回 0），这时 mpv 只记一条 `Unknown profile 'fntv-defaults'` 警告，以内置默认值照常启动。
- 写在 `[profile]` 段里的 include 只在应用这个 profile 时读。

## 能力（`provides` 和 `requires`）

清单的 `provides` 声明归档里的插件给客户端提供的能力，名字到版本号。客户端代码里写死 `requires`（能力名到最低版本），构建期和启动时各检查一次（见 [external-runtime.md](external-runtime.md)）。

| 能力 | 版本 | 含义 | 首个归档 |
| --- | --- | --- | --- |
| `smart-skip.origin-from-play-url` | 1 | smart_skip 从播放地址取 scheme、主机和端口，请求 Proxy 的 `GET /api/v1/skipinfo/:itemGuid?session=…` 和 `POST /api/v1/skipinfo?session=…`；Proxy 的端口每次启动都可能不同 | `fntv-mpv-v20261110_224319`（#167） |

插件和客户端之间的约定变了：不兼容时升这个能力的版本，新约定用新名字时加一项，同时改客户端的 `requires`。

## 改归档时的检查项

在 fntv-mpv-config：

- 上面“客户端依赖的路径”一项都没有改名、移动或删除；要动就先改客户端。
- 新文件归到正确的 `role`；新插件目录加进 `managedDirs`。
- 删掉的托管文件移进 `obsolete`，带上全部历史哈希。
- 历史哈希只增不减。
- `mpv.conf` 前两个有效行仍是 `~~/` 前缀的 include 和 `profile=fntv-defaults`，在任何 profile 段之前；默认值改在 `fntv/defaults.conf` 的 `[fntv-defaults]` 段里。
- 没有带 `fntv/installed.json`、`*.fntv-new`、`.fntv-sync-*`、`script-opts/smart_skip.conf`。
- 插件和客户端之间的约定变了时，改 `provides`。
- 改了同步规则的含义时升 `formatVersion`，并且先发支持它的客户端。
- 打包后的契约测试通过。

在 fntv-electron：

- 用 `scripts/update-mpv-archive.cjs` 或 “Update MPV archive” workflow 固定新归档，不手改（见 [external-runtime.md 的“MPV 归档”](external-runtime.md#mpv-归档)）。
- 构建期清单断言通过：`formatVersion` 认识，`archiveVersion` 等于固定的 tag，`provides` 满足 `requires`。升级 PR 改了 `mpv-archive.json`，会触发 Smoke Test 构建并跑这个断言；`ci.yml` 不下载归档，不跑它。
