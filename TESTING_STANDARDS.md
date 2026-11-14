# 测试标准

## 运行

- `pnpm test`：编译到 `dest/` 后运行全部 `tests/*.test.cjs`。单独运行某个测试前先 `pnpm run compile`。
- `pnpm run watch` 不清理 `dest/`，删过源文件后跑一次 `pnpm run compile`，否则旧 js 还会被 `readdirSync` 加载。
- 改完代码后 `pnpm run lint` 和 `pnpm run knip` 也要通过。

### `Electron failed to install correctly`

`tests/accessCodeSession.test.cjs` 在加载时报这个错，说明第一次 `require('electron')` 时按需下载或解压 Electron 二进制失败。这是环境问题，多半是网络。运行 `node node_modules/electron/install.js` 重新下载，看它的报错；镜像用 `ELECTRON_MIRROR` 环境变量。`node_modules/electron/path.txt` 存在、`dist/version` 和包版本一致才算解压完成。

## `tests/*.test.cjs` 写法

- 用 CommonJS、`node:test` 和 `node:assert/strict`，从 `../dest/...` 引入编译产物。
- 测试名用一句英文写清行为，例如 `first initialization does not overwrite pre-existing user state`。
- 用到文件系统时，在 `fs.mkdtempSync(path.join(os.tmpdir(), ...))` 里操作，并用 `t.after` 清理（`tests/mpvConfigMigration.test.cjs`）。
- 模块支持注入依赖时，直接传假对象（`establishAccessCodeSession` 的 `gatewaySession`、`requester`）。
- 模块直接使用 Electron API 时，用 `tests/helpers/fakeElectron.cjs` 的 `useFakeElectron(t, 假对象, { platform })` 替换 `electron`，它负责恢复、清理 `dest/` 模块缓存和模拟平台（`tests/trayMpvMenu.test.cjs`）。
- CI 在 Windows、macOS 和 Linux 上都跑，Electron 假对象要包含各平台分支用到的 API，例如 Linux 才调用的 `safeStorage.getSelectedStorageBackend`。按平台跳过的测试由 CI 三平台矩阵验证，本地只确认它在本机是跳过而不是失败，并在报告里写明哪个平台的分支待 CI 验证，不要在本机临时拼装其他平台的运行环境。单独跑测试文件时也加 `--test-timeout=30000`，和 `pnpm test` 一致。
- 更新检查的测试替换 `axios.get` 返回 GitHub 响应，HTTP 错误用真实的 `axios.AxiosError` 构造（`tests/updateChecker.test.cjs`）。

## 只测外部行为

- 断言公开入口的输入、输出和落盘结果，不绑定内部函数和调用顺序。例如 `synchronizeMpvConfig` 的测试只看返回值和目录内容。
- 测试走模块已有的公开入口或依赖参数，不为测试新增接缝。只有超时、间隔这类时间参数例外，可以写成带默认值的可选参数注入（`ProxyServiceOptions` 的 `quarkIdleTimeoutMs`）。
- 文本断言只用于没有运行入口的内容：`resource/login/` 下的页面、样式、脚本和窗口安全选项（`tests/rendererIsolation.test.cjs`）。
- 测试失败时先判断是行为回归还是测试过期，只有测试过期才改断言。

## 冒烟测试

`tests/smoke/` 把安装包当黑盒，不引入源码，`pnpm test` 不包含它。运行方式见 `tests/smoke/README.md`。

- `tests/smoke/targets.cjs` 是目标平台的唯一来源，断言在 `tests/smoke/installer.smoke.cjs`，所有目标共用。
- 在主进程里执行代码（`app.evaluate`）前先等 `app.firstWindow()`。客户端创建主窗口期间收到的 `app.evaluate` 会以 `Resulting promise was garbage collected` 失败。

## 配置和工作流

- 配置类改动用 `git grep` 做静态验收，结果只能剩下有意保留的内容。能写成断言的放进 `tests/standards.test.cjs`。
- 工作流改动要有真实运行记录作为证据，只读 YAML 不算验证。
- workflow 产物（安装包、更新元数据）的证据是 CI 运行链接和对应步骤的日志，不要在本地下载 artifact 核对。
