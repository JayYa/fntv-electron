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
- 脱敏过程按 fail-closed 处理：一旦脱敏抛出异常，返回 `[MASKING_ERROR: ...]` 而不是原始数据，避免敏感信息在异常路径泄漏。
