---
status: accepted
---

# 平台差异按平台分文件，由一张表选取

平台差异原来集中在 `src/public/platform.ts`，每个函数里用 `if (platform === 'win32')` 分支。lint 只拦截直接比较 `currentPlatform()`，先存进变量再比较的写法要靠审查。现在改成 `src/public/platform/` 目录：`win32.ts`、`darwin.ts`、`linux.ts` 各实现一份 `PlatformImpl`（`shared.ts`），macOS 和 Linux 共用的逻辑在 `posix.ts`；`index.ts` 用 `Record<'win32' | 'darwin' | 'linux', PlatformImpl>` 查表，这是唯一选平台的地方。src 里任何地方都不和 `'win32'`、`'darwin'`、`'linux'` 比较或 `case` 它们，平台目录也一样，lint 拦截。preload 不读 `navigator.platform`，标题栏样式由主进程通过 `get-title-bar` 给出。

## 维护者的决定（2026-11-20）

- **没有自己实现的平台（freebsd 之类）按 Linux 运行。** 回退只写在 `index.ts` 的 `implFor` 里。比原来多的影响：拒绝 basic_text 凭据后端，按 Linux 的位置找 mpv。安装包名和应用内更新例外：这些平台没有安装包，`installerAssetName` 返回 null，更新提示不给下载链接，`inAppUpdateAvailability` 返回不可用。
- **对外函数的签名不变**，仍接收平台参数，测试走公开 API 在任意主机上覆盖三个平台，不单独测平台文件。
- **每个平台文件把 `platformBehavior` 写成完整的字面量**，Windows 和 Linux 相同的文案也各写一份；接口保证不漏字段。`posix.ts` 只共用函数逻辑。

## Considered Options

- **保留单文件里的 `if`**：放弃。一个平台的行为散在各函数里，平台比较只能靠审查拦。
- **按 `process.platform` 动态 `require('./platform.' + platform)`**：放弃。tsc、knip 和打包都追踪不到，类型检查也丢了。
- **构建时只打包当前平台的文件**：放弃。要改 tsc 和 electron-builder 的流程，三个平台的文件一起打包只多几 KB。
- **按功能分目录（如 `mpvIpcSocket/{win32,posix}.ts`）**：放弃。整体只有两百多行，按功能拆会多出很多只有几行的文件。

## Consequences

- 加一个平台差异：在 `PlatformImpl` 加字段，三个平台文件不写全就编译不过。
- 平台判断写不出来，lint 直接拦截；按能力字段（如 `behavior.titleBar === 'hiddenInset'`）判断仍然允许。
- 标题栏多一次 IPC 往返，页面 ready 后才拿到样式。
