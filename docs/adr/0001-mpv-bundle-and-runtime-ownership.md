# MPV 打包与运行时归属

`fntv-mpv-config` 负责选择上游、固定版本、下载解压、提供自定义默认配置，并产出完整的 MPV 归档。`fntv-electron` 只消费这个归档，不查询也不覆盖单个上游插件仓库。这样版本只有一个来源，Release 构建也不会混入移动分支上的快照。运行时契约见 [external-runtime.md](../external-runtime.md)。

## 运行时升级范围

> 已被 [ADR-0005](0005-mpv-archive-manifest-sync.md) 取代：MPV 归档带清单，用户配置按清单里每个文件的归属同步，规则见 [MPV 归档契约](../mpv-archive-contract.md)。新规则已由 #221–#224 落地生效，客户端不再按下面的范围工作。下面是原来的决定。

已安装用户升级时，只有 `scripts/uosc_danmaku` 由应用整体替换。`danmaku-history.json`、`script-opts` 和其它脚本归用户所有。全新安装时复制一次完整配置，随包的历史种子只保留默认可见性标记，不分发媒体匹配记录。

## 播放归属字段

旧字段 `hideOriginalPlayButton` 继续表示 MPV 是否接管播放，不改名，以兼容已有配置。主进程和 preload 共用一个判断函数，避免缺失值和超时回退再次不一致。

这个决策当初写的是“只有字面量 `true` 启用，缺失值走网页端自带播放器”。v2.6.2（`f9cf723`）已改回：缺失值和 `true` 都启用 MPV，用户明确关闭的选择保持不变。以当前代码为准。

## Proxy 密钥持久化

> 已被 [ADR-0004](0004-proxy-in-typescript-utility-process.md) 取代：Proxy 改为 `utilityProcess` 子进程，随客户端退出，密钥、`proxy-secret` 文件、`/health` 和孤儿复用都已删除。下面是原来的决定。

Electron 把 Proxy 密钥存在 `userData` 下，并跨重启复用。Electron 异常退出后，Proxy 可能继续运行并占着固定端口。如果每次启动都换密钥，下一个 Electron 进程既无法认证这个 Proxy，也绑不了端口。端口、认证后的健康检查、守护逻辑和短期播放会话都保持原样。

## Considered Options

- **Electron 构建时单独拉取插件**：放弃。这会多出第二个版本来源，曾经的做法是下载归档后再用上游 `main` 快照覆盖。
- **同步时替换整个配置目录**：放弃。这会抹掉用户的弹幕历史和选项。
- **通用的托管路径清单**：暂缓。目前只有 `uosc_danmaku` 需要就地升级，有更多插件需要时再单独设计。已被 [ADR-0005](0005-mpv-archive-manifest-sync.md) 取代：改为清单列出每个文件的归属。

## Consequences

- 改插件版本要先在 `fntv-mpv-config` 发布新归档，再构建 Electron。
- 回滚只需恢复之前的配置依赖或 Release，并回退 Electron 改动。用户状态始终在被替换的插件目录之外。
- 构建固定到 `JayYa/fntv-mpv-config` 的一个 tag 并校验 sha256，不取 `releases/latest`（Spec #18）。`update-mpv-archive.yml` 定时读最新 Release，只开 PR 改固定的 tag，合并前构建仍用旧的固定值（2026-11-14）。
