# MPV 归档契约

改 `JayYa/fntv-mpv-config` 产出的 MPV 归档，或改客户端的用户配置同步时读这份文档。它写客户端依赖归档的什么、同步按什么规则改用户配置、哪些东西不能动。决策原因见 [ADR-0005](adr/0005-mpv-archive-manifest-sync.md)，需求见 spec #219。

> **尚未生效**：下面的清单和同步规则由 #221–#224 和 fntv-mpv-config#3–#5 落地。在那之前客户端仍按 [external-runtime.md 的“用户配置同步”](external-runtime.md#用户配置同步) 工作：只替换 `scripts/uosc_danmaku`，其它文件不动。每张票落地时，把本页对应部分的说明和 external-runtime.md 一起改掉。

术语以 [GLOSSARY.md](../GLOSSARY.md) 为准：MPV 归档、便携配置、用户配置、托管文件、用户可改文件、种子文件、清单、历史哈希、能力、安装记录、待合并更新。

## 归档里客户端依赖的路径

路径相对 MPV 归档根目录（构建时解压到 `third_party/fntv-mpv`）。改名、移动或删除下面任何一项，都要先改客户端。

| 路径 | 谁用 | 说明 |
| --- | --- | --- |
| `fntv-manifest.json` | 同步、构建期断言、启动时能力检查 | 清单，格式见下文。macOS/Linux 的安装包只带便携配置，打包配置（`package.json` 的 `extraFiles`，两处）要把它一起带上（#221） |
| `portable_config/` | 同步 | 便携配置，同步的来源（`resolvePortableConfigDir`） |
| `mpv.exe` | Windows 播放 | 附带 MPV，只在 Windows 安装包里 |
| `portable_config/mpv.conf` | MPV | 薄文件，见“`mpv.conf` 分层” |
| `portable_config/fntv/defaults.conf` | MPV | 默认值，由 `mpv.conf` include |
| `portable_config/scripts/uosc_danmaku/main.lua` | 同步 | 弹幕插件入口，现有同步缺它时抛错 |
| `portable_config/scripts/smart_skip/` | MPV 播放时 | 片头片尾跳过，依赖下文的能力 `smart-skip.origin-from-play-url` |
| `portable_config/danmaku-history.json` | 弹幕插件 | 弹幕历史的种子。fntv-mpv-config 打包时把 `custom_config/<组件>/` 下的文件铺到便携配置根下，所以它在根目录 |

用户配置里下面这些名字归客户端，归档里不能出现同名文件：

- `fntv/installed.json`：安装记录。
- `.fntv-sync-*`：用户配置根目录下的暂存目录。MPV 只从 `scripts/` 加载脚本，放在根目录不会被当成脚本加载。
- `<文件>.fntv-new`：待合并更新。

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

### `formatVersion`

`formatVersion` 是同步规则的版本，不是归档的版本。客户端代码里列出它认识的版本（目前只有 `1`）。

- 遇到不认识的版本或清单缺失：同步什么都不改，记 ERROR，不阻塞启动。用错误的规则改用户配置比不改更糟。
- 改了已有字段的含义，或者加了旧客户端不懂就会改错用户配置的规则，才升版本。加一个旧客户端忽略也不会改错的字段，不升。
- 升版本前，先发认识新版本的客户端；否则还没升级客户端的用户一个文件都同步不到。

## 归属

| `role` | 范围 | 规则 |
| --- | --- | --- |
| `managed`（托管文件） | `scripts/**`、`fonts/**`、`shaders/**`、`fntv/defaults.conf` | 总是覆盖成新版。用户改过也覆盖，不备份，记 INFO |
| `config`（用户可改文件） | `mpv.conf`、`input.conf`、`script-opts/*.conf` | 缺失则补；没改过则换新；改过则原文件不动，新版写成 `<文件>.fntv-new`；改过、但新版和上次装入的一样，什么都不做 |
| `seed`（种子文件） | `danmaku-history.json` | 只在缺失时复制 |

“没改过”的判断：有安装记录时，当前哈希等于记录里这个文件装入的哈希；没有安装记录时，当前哈希在这个文件的 `knownHashes` 里。

所有规则之前先判断“当前内容已等于新版”：等于就不动。这保证同步中途失败或退出后，下次启动重跑能补完，已到位的文件不再动。

### 整目录托管

`managedDirs` 里的目录整体替换：在暂存目录复制出完整的新目录，把旧目录里**清单没列出的文件**带过去，再用 rename 整目录换掉，失败时回滚。所以用户放进插件目录的自己的文件会保留；清单列出的文件一律是新版。

uosc_danmaku 的 `check-update` 自更新会改写它自己的插件目录，下次启动被改回归档里的版本：插件版本只有归档这一个来源。

### 删除

- 安装记录里有、新清单 `files` 里没有的托管文件：当前哈希等于记录值才删。
- 没有安装记录时，按 `obsolete` 里这个路径的 `knownHashes` 判断，在里面才删。
- 从清单里删掉的用户可改文件一律保留。

所以 fntv-mpv-config 删掉一个托管文件时，要把它连同全部历史哈希移到 `obsolete`，没有安装记录的老用户才能清掉它。

### `mpv.conf` 在 macOS/Linux 上的例外

macOS/Linux 上的用户配置就是用户日常使用 mpv 的目录（`~/.config/mpv` 或 `~/.mpv`），那里的 `mpv.conf` 可能是用户自己写的。没有安装记录、当前 `mpv.conf` 又不在 `knownHashes` 里时，当成用户自己的配置：不写 `.fntv-new`，不进冲突列表；`fntv/defaults.conf` 照装。有安装记录后和 Windows 一样。

## 安装记录

存在用户配置下的 `fntv/installed.json`，内容：

- 归档版本；
- 每个文件装入时的哈希；
- 装入归档的 `provides`；
- 已确认的冲突：路径加新版哈希。

只在同步全部完成后写。同步失败时不写，下次启动重试。同步目标换了（改了自选 MPV、设了 `MPV_HOME`）时，新目录有自己的安装记录，互不影响。安装记录是客户端自己的文件，具体字段名由 #222 定，不是和归档的契约。

## 写入方式和失败

- 新内容先写进用户配置根目录下的 `.fntv-sync-*` 暂存目录，校验哈希、fsync，再 rename 到位。`.fntv-new` 也这样写。启动时先清理残留的暂存目录。
- 同步失败：已到位的文件保留，不写安装记录，记 ERROR，不阻塞启动，下次启动重试。
- 只在客户端启动时同步。改了 MPV 播放器路径要重启客户端才同步到新目录。
- 同步结果按文件列出动作（换新、写 `.fntv-new`、保留、补缺、删除、跳过），写进日志。

## 待合并更新和提示

- 本次同步有未确认的冲突时，弹一次非模态对话框，列出文件，按钮“打开配置目录”“知道了”。关闭后把这些冲突（路径加新版哈希）记为已确认，同一版本不再弹；没关就退出，下次启动再弹。
- 用户配置里还有 `.fntv-new` 时，托盘“设置”子菜单显示“MPV 配置有 N 个待合并的更新”，点击打开用户配置目录。删掉或合并完 `.fntv-new` 后不再显示。
- 下一个归档又改了同一文件时，新的 `.fntv-new` 替换旧的，再提示一次。
- 没有安装记录的首次迁移（例如从上游 QiaoKes 客户端迁来，文件哈希不在历史哈希里），提示文案说明这是一次性迁移。

## `mpv.conf` 分层

`input.conf` 和 `script-opts` 不分层：mpv 和 `mp.options` 都只读一个文件，没有 include。只有 `mpv.conf` 分层：

- `fntv/defaults.conf` 是托管文件，放全部默认值。改默认值只改它。
- `mpv.conf` 是用户可改文件，首个有效行是 `include="~~/fntv/defaults.conf"`，其余只有注释，说明“自己的设置写在这行后面”。用户的设置写在后面，覆盖默认值。没改过 `mpv.conf` 的用户以后不会再有冲突。

规则：

- include 路径必须带 `~~/` 前缀。
- include 必须在第一个 `[profile]` 段之前。
- 契约测试检查这两条。

依据（mpv master `bb4823e`）：

- 配置文件逐行解析（`options/parse_configfile.c`）。`include` 是特殊选项，解析到它时立即读入目标文件：`options/m_config_frontend.c` 的 include 分支调 `player/main.c` 的 `cfg_include`。同名普通选项后写的生效，所以 include 行之后的设置覆盖默认值。
- 路径经 `mp_get_user_path` 展开：`~~/` 是 MPV 配置目录；不带前缀的相对路径按进程当前目录算，换个工作目录启动就找不到。
- 被 include 的文件不存在时不报错（`m_config_parse_config_file` 返回 0），所以 `defaults.conf` 缺失时 MPV 会静默地以内置默认值运行。嵌套最多 8 层。
- 写在 `[profile]` 段里的 include 只在应用这个 profile 时读。
- mpv 手册只写了命令行 `--include` 在默认配置之后读；“行内展开、后写覆盖”是从源码推断的，fntv-mpv-config#5 用附带 MPV 加 `--log-file` 实测一次。

## 能力（`provides` 和 `requires`）

清单的 `provides` 声明归档里的插件给客户端提供的能力，名字到版本号。客户端代码里写死 `requires`（能力名到最低版本）。

| 能力 | 版本 | 含义 | 首个归档 |
| --- | --- | --- | --- |
| `smart-skip.origin-from-play-url` | 1 | smart_skip 从播放地址取 scheme、主机和端口，请求 Proxy 的 `GET /api/v1/skipinfo/:itemGuid?session=…` 和 `POST /api/v1/skipinfo?session=…`；Proxy 的端口每次启动都可能不同 | `fntv-mpv-v20261110_224319`（#167） |

- 构建期：测试读固定归档的清单，`formatVersion` 不认识或 `provides` 不满足 `requires` 时失败（#221）。
- 启动时：用安装记录里的 `provides` 检查用户配置里实际装上的版本；不满足（同步失败、清单缺失）时记 ERROR、托盘显示状态，不阻塞启动。`same-directory` 没有安装记录，直接读归档的清单（#224）。
- 插件和客户端之间的约定变了：不兼容时升这个能力的版本，新约定用新名字时加一项，同时改客户端的 `requires`。

## 同步目标是便携配置本身

用户把自选 MPV 指向附带 MPV 时，用户配置就是便携配置（按 realpath 比较，#118），同步跳过（`same-directory`），不写安装记录，记 WARN。这时用户改的是安装目录里的便携配置，下次安装包升级会被新版本整个覆盖，不会有 `.fntv-new`，也没有提示。

自选 MPV 旁边有自己的 `portable_config`（#114）或设了 `MPV_HOME` 时，同步写到那里，规则不变。

## 改归档时的检查项

在 fntv-mpv-config：

- 上面“客户端依赖的路径”一项都没有改名、移动或删除；要动就先改客户端。
- 新文件归到正确的 `role`；新插件目录加进 `managedDirs`。
- 删掉的托管文件移进 `obsolete`，带上全部历史哈希。
- 历史哈希只增不减。
- `mpv.conf` 首个有效行仍是 `~~/` 前缀的 include，在任何 profile 段之前；默认值改在 `fntv/defaults.conf`。
- 没有带 `fntv/installed.json`、`*.fntv-new`、`.fntv-sync-*`、`script-opts/smart_skip.conf`。
- 插件和客户端之间的约定变了时，改 `provides`。
- 改了同步规则的含义时升 `formatVersion`，并且先发支持它的客户端。
- 打包后的契约测试通过。

在 fntv-electron：

- 用 `scripts/update-mpv-archive.cjs` 或 “Update MPV archive” workflow 固定新归档，不手改（见 [external-runtime.md 的“MPV 归档”](external-runtime.md#mpv-归档)）。
- 构建期清单断言通过：`formatVersion` 认识，`provides` 满足 `requires`。
