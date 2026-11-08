# 更新检查

相关：[发布与更新链路](release-and-update.md)（发版流程、构建和更新源的事实）、[多平台测试策略](multi-platform-testing.md)。

2026-11-08 从 [发布与更新链路](release-and-update.md) 拆出（单文件不超过 20000 字节），以下各节原文未改。更新源、Linux 产物名匹配等 2026-11-05 的事实和 v2.7.0 发版验收里的更新检查核实仍在原文件。

## 2026-11-07 实现记录（PR #62 分支，`51c60a8`，尚未合并）（“尚未合并”已被取代：PR #62 合并为 `46cba98`）

- 更新提示框的正文原来直接显示 Release 的 Markdown，release-please 生成的版本标题行、`**scope:**`、提交哈希和 PR 链接都按原始文本显示。现在由 `src/modules/updater/releaseNotes.ts` 的 `formatReleaseNotes` 转成纯文本：去掉版本标题行，分组标题只留文字（如“新功能”），列表项以 `• ` 开头，去掉条目末尾的提交和 PR 括注以及 `, closes #N`，其它链接只留链接文字，去掉 `**` 和反引号，合并多余空行。
- 原生对话框不能滚动，原来没有长度限制。现在超过 15 行或 800 个字符时截断，末尾提示点“查看详情”打开 Release 页面。正文为空时仍显示“暂无更新说明”。（上限已被下方 2026-11-07 更新说明截断修正记录取代）
- 测试样例按 `googleapis/release-please` v17.11 的 Release 正文格式编写，分区换成本仓库的中文分区（`tests/releaseNotes.test.cjs`、`tests/updateChecker.test.cjs`）。

## 2026-11-07 更新说明截断修正记录（PR 分支 `t3/updater-release-notes-truncation`，`3e3d38f`，尚未合并）（“尚未合并”已被取代：该分支即 PR #66，合并为 `5b63e64`，随 v2.7.1 发布）

- v2.7.0 的真实 Release 正文转成纯文本后有 17 行、451 个字符，超过 15 行上限，最后两条 `updater` 条目被截掉。字符数没有超。
- `formatReleaseNotes` 去掉条目开头的 release-please scope 前缀（Markdown 里的 `**login:** `），只认条目开头加粗的这种写法，正文里的冒号不动。
- 上限改为 25 行或 1300 个字符，按原来每行约 53 个字符的比例放宽。v2.7.0 的 14 条全部显示，不截断。
- 测试样例是 `gh api repos/JayYa/fntv-electron/releases/tags/v2.7.0` 返回的 `body`，原样存为 `tests/fixtures/release-v2.7.0.md`（`tests/releaseNotes.test.cjs`）。

## 2026-11-07 检查更新 403（`JayYa/fntv-electron@17ac14c`，尚未合并）（“尚未合并”已被取代：分支 `t3/updater-rate-limit` 即 PR #68，合并为 `5570836`，随 v2.7.1 发布）

- 现象：点“检查更新”弹出 `Request failed with status code 403`。
- 证据：维护者本机日志 `%APPDATA%\fntv\logs\app.log`（不是 `~/.fntv/logs`）里，20:42:33 到 20:48:46 共 7 次检查、28 个请求全部 403，第一次检查的第一个请求就是 403，说明额度在应用请求前已经被同一出口 IP 上的其它请求用掉。旧日志只记了 `error.message`，没有 `x-ratelimit-remaining` 和错误正文，限流没有直接证据。
- 旁证：20:52 查 `/rate_limit`，`limit` 60、`used` 39、`reset` 21:14，即当时的出口 IP 在 20:14 起的窗口里没有用完。本机有 Mihomo TUN 网卡，出口是代理节点，节点会切换，也和其他用户共用。结论：最可能是出口 IP 触发未认证 API 限流，旧代码 403 也重试 3 次，进一步消耗额度。
- 实测：未认证时带 `If-None-Match` 得到 304，`x-ratelimit-remaining` 照样减 1（18 → 17）。GitHub 只对带认证的请求免计 304，所以没有做 ETag 缓存。
- `github.com/JayYa/fntv-electron/releases/latest` 返回 302，`Location` 指向 `/releases/tag/v2.7.0`，不走 API 限流。v2.7.0 的资产名：`FNMedia_2.7.0_win_x64.exe`、`FNMedia_2.7.0_mac_{arm64,x64}.dmg`、`FNMedia_2.7.0_linux_{x86_64,arm64}.AppImage`。
- 修复：只重试网络错误、超时和 5xx；403/429 限流时记下恢复时间，之前直接查 Release 页面；都失败时提示“GitHub 访问次数暂时用完，大约 HH:mm 之后可以重试”，并提供“打开下载页面”。失败日志现在带状态码、`x-ratelimit-remaining`、`x-ratelimit-reset` 和错误正文，下次能直接确认。
