---
status: accepted
---

# MPV 归档带清单，用户配置按 conffile 方式同步

ADR-0001 只让 `scripts/uosc_danmaku` 在升级时被替换，其它文件归用户所有。结果老用户的 `mpv.conf`、`input.conf`、`script-opts`、uosc、thumbfast、smart_skip、字体和着色器都停在第一次安装时的版本，归档新加的插件也装不上；弹幕插件整目录替换，用户放进去的文件会丢；客户端依赖插件的行为（smart_skip 从播放地址取 Proxy 端口）只写在文档里。所以 MPV 归档带一份清单 `fntv-manifest.json`，给便携配置里每个文件标出哈希和归属，客户端启动时按 dpkg conffile 的做法同步：托管文件总是换新，用户可改文件没改过才换新、改过就把新版写成旁边的 `.fntv-new` 并提示，种子文件缺失才补；`mpv.conf` 分层为薄文件 include 托管的 `fntv/defaults.conf`；清单用 `provides` 声明能力，客户端构建时和启动时检查。规则细节见 [MPV 归档契约](../mpv-archive-contract.md)，需求见 spec #219。

这一条取代 ADR-0001 的“运行时升级范围”和 Considered Options 里“通用的托管路径清单：暂缓”。

## 维护者的决定（2026-11-14）

- **不收录上游 QiaoKes 归档的历史哈希。** 历史哈希只覆盖本 fork 发过的归档。从上游客户端迁来、没改过配置的用户第一次升级时会收到一次性的 `.fntv-new` 提示，提示文案说明这是迁移，维护者接受这一次提示。
- **托管文件被用户改过时直接覆盖，不备份。** 托管文件是插件代码、字体、着色器和 `fntv/defaults.conf`，用户的设置应该写在用户可改文件里。覆盖记 INFO 日志。
- **macOS/Linux 上没有安装记录、且不在历史哈希里的 `mpv.conf` 当成用户自己的配置，不提示。** 这些平台的用户配置就是用户日常使用 mpv 的目录，客户端装进来之前那里的 `mpv.conf` 多半是用户自己写的，提示合并客户端的版本是打扰。`fntv/defaults.conf` 照装。

## 维护者的决定（2026-11-15）

- **macOS/Linux 上 `mpv.conf` 的例外按单个文件判断。** 当成用户自己配置的 `mpv.conf` 不记进安装记录，以后有了安装记录也不对它提示合并，而不是“有安装记录后和 Windows 一样”。只有客户端装进来的 `mpv.conf` 才按 Windows 的规则处理（#219 的评论）。

## Considered Options

- **维持只托管 `uosc_danmaku`**：放弃。默认配置和其它插件的修复到不了老用户。
- **每次启动整体覆盖整个配置**：放弃。会抹掉用户改过的配置和弹幕历史，ADR-0001 已经否决。
- **用户可改文件被改过时也覆盖、留备份**：放弃。用户的设置会在每次升级后失效，得自己从备份里搬回来。
- **在客户端里做三方合并或合并界面**：不做。`.fntv-new` 放在原文件旁边，用户用文本对比工具合并即可。
- **`input.conf`、`script-opts` 也分层**：做不到。mpv 和 `mp.options` 对这些文件都只读一个，没有 include。

## Consequences

- 改归档的人要遵守契约：客户端依赖的路径不能动，历史哈希只增不减，删掉的托管文件进 `obsolete`。fntv-mpv-config 打包后跑契约测试，失败不发版。
- 清单的 `formatVersion` 是同步规则的版本；客户端不认识时什么都不改。改规则要先发支持它的客户端。
- 同步会改 macOS/Linux 上用户日常使用 mpv 的目录（现有行为，未改变）。
- 自选 MPV 指向附带 MPV 时同步跳过，用户在安装目录里的改动随安装包升级被覆盖。
