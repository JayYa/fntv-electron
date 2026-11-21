---
status: accepted
---

# lint 规则守住的架构约束

`eslint.config.mjs` 里 `no-restricted-*` 规则各自守一条约束。每条的拦截写法由对应的 `tests/eslint*Rules.test.cjs` 检查。

## 规则和理由

- **`no-alert`**：浏览器原生弹窗在 Electron 里不可靠，确认和输入走主进程的 `dialog` 或页面内组件。
- **`safeStorage` 同步方法**（`isEncryptionAvailable`、`encryptString`、`decryptString`）：Electron 45 弃用、46 删除，用对应的 `*Async`（`tests/eslintSafeStorageRules.test.cjs`）。
- **IPC 处理器只经 `registerHandler` 注册**：它捕获并记录 `ipcMain.on` 处理器的同步和异步错误，还拦下重复注册。只有 `src/main/handlers/core/ipcHandler.ts` 能直接调用 `ipcMain.handle`、`on` 等（`tests/eslintIpcRules.test.cjs`）。
- **只在 `src/public/platform/index.ts` 读当前平台**（ADR-0006）。`no-restricted-properties` 只认对象名，`os` 模块换个写法导入就拦不住，所以另用 `no-restricted-syntax` 禁掉从 `os` 导入或解构 `platform`、`arch`，以及用 `os` 以外的名字导入 `os` 模块。不用 `no-restricted-imports` 的 `importNames`：它连 `import * as os` 也一起拦下。
- **不写 `module.exports =`**：整体替换 export 的结果，新函数没加进表时运行时是 `undefined`，tsc 查不出。
- **`before-quit` 和系统关机信号只在退出协调模块监听**（`src/modules/quit/quitCoordinator.ts`）：退出收尾的先后顺序只由它决定，其它模块向它注册（`initQuitCoordinator`、`onQuitStarted`、`provideInstallOnQuit`）。关机、重启或注销的信号是窗口的 `session-end` 和 `powerMonitor` 的 `shutdown`（#192，`tests/eslintQuitRules.test.cjs`）。lint 拦字面量，测试拦其余写法：lint 只认事件名直接写在调用参数里的字符串或模板字面量，`const e = 'before-quit'; app.on(e, …)` 这样先放进变量的写法拦不住；同一个测试文件扫描 `src/` 下全部文件，`before-quit`、`session-end` 和带引号的 `'shutdown'` 只能出现在退出协调模块里，出现在别处时测试失败并列出文件（#261）。
- **`fn_api/core` 和 Proxy 服务不加载 `electron`**：`fn_api/core` 由主进程和 Proxy 共用，Proxy 服务运行在 `utilityProcess` 里。logger、`cert_trust` 和 `fn_api` 的主进程层会间接加载 electron，所以 core 只引用 Node 内置模块、npm 包和 core 本身，Proxy 服务另外只能引用 `fn_api/core`；日志和证书信任由调用方传入（`tests/eslintElectronFreeRules.test.cjs`）。
- **测试里替换 `require` 的模块用 `tests/helpers/fakeElectron.cjs`**，不直接改 `Module._load`。
- **登录页脚本按经典 `<script>` 解析**（`sourceType: 'script'`），不是模块（`CODING_STANDARDS.md`）。
