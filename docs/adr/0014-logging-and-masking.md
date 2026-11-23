---
status: accepted
---

# 日志目录与脱敏策略

`src/modules/logger/` 负责客户端日志落盘、轮转与敏感信息脱敏。

## 目录选择与非 Electron 环境兼容

- 打包后日志写在 `~/.fntv/logs`，重装客户端不会清空日志。日志器在 `config.ts` 调用 `app.setPath('userData')` 之前加载，因此直接读 `src/public/constants.ts` 的 `USER_DATA_PATH` 而非 `app.getPath('userData')`（#87，见 [ADR-0011](0011-platform-behavior-facts.md)）。
- 单元测试等非 Electron 环境也会导入日志模块，因此 `require('electron')` 放在 `try/catch` 中，失败时退回到当前工作目录下的 `log/`。
- `src/public/constants.ts` 仅依赖 `electron`（不会与 logger 循环导入），但它会访问 `app.commandLine`，在非 Electron 环境中加载会抛错；因此只在 `app && app.isPackaged` 分支里按需 `require`。

## 脱敏与 `NOFORMAT`

- `LogLevel.NOFORMAT` 只省略时间戳和日志级别前缀（用于转发 Proxy 输出），但仍经过 `maskStringByPatterns` 脱敏，不能绕过脱敏直接落盘。
- 脱敏总是开启（`maskingEnabled`），不随日志级别关闭：调试日志同样会写进持久化的日志文件。
- IP 地址只保留前两段。匹配 IP 的正则不用 `\b`：URL 编码的 `%2F192.168.0.1` 里 `F` 和 `1` 之间没有词边界，改用前后不是数字或点的环视。
- 匹配到的值看起来像文件路径时不脱敏（`isFilePath`），这样 `[utils.go:171]` 这类源码位置能保持可读。但以 `http(s)://` 开头的值一律按 URL 脱敏：文件路径规则 `/\/[^\/\s]+\//` 对任何带路径的 URL 都成立，以前 `http://nas.local:5666/v/api` 这类局域网地址会因此原样写进日志（#292）。
- `url` 键的规则只认独立的 `url`（前面不是字母、数字、`_`、`-`、`.`）和驼峰键的 `Url`/`URL` 结尾（`playUrl`、`baseURL`），后面要跟 `:` 或 `=`。以前任何以 `url` 结尾的词都算，mpv 能力名 `smart-skip.origin-from-play-url` 后面的文字会被遮掉（#296）。
- 脱敏过程按 fail-closed 处理：一旦脱敏抛出异常，返回 `[MASKING_ERROR: ...]` 而不是原始数据，避免敏感信息在异常路径泄漏。
- 渲染进程报告的页面地址只记协议和主机：路径和查询串可能带 token。
