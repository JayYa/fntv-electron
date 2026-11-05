# 测试标准

## 运行

- `pnpm test`：编译到 `dest/` 后运行全部 `tests/*.test.cjs`。
- `go test ./...`：改 Go 代码时在 `src/modules/proxy` 下运行。
- CI 两项都跑（`.github/workflows/ci.yml`）。

### `Electron failed to install correctly`

`tests/accessCodeSession.test.cjs` 在加载时报这个错，说明 `node_modules/electron/dist` 不完整。这是环境问题。先确认 `pnpm-workspace.yaml` 的 `allowBuilds` 有 `electron`、`overrides` 有 `extract-zip>yauzl`，再删掉 `node_modules` 重新 `pnpm install`。`node_modules/electron/path.txt` 存在才算解压完成，`electron postinstall: Done` 证明不了。

## `tests/*.test.cjs` 写法

- 用 CommonJS、`node:test` 和 `node:assert/strict`。
- 从 `../dest/...` 引入编译产物，单独运行前先 `pnpm run compile`。
- 测试名用一句英文写清行为，例如 `first initialization does not overwrite pre-existing user state`。
- 用到文件系统时，在 `fs.mkdtempSync(path.join(os.tmpdir(), ...))` 里操作，并用 `t.after` 清理（`tests/mpvConfigMigration.test.cjs`）。
- 模块支持注入依赖时，直接传假对象（`establishAccessCodeSession` 的 `gatewaySession`、`requester`）。
- 模块直接使用 Electron API 时，替换 `Module._load` 返回 `electron` 的假对象，结束后恢复（`tests/credentialStorage.test.cjs`）。
- CI 跑在 Linux 上，Electron 假对象要包含平台分支用到的 API，例如 Linux 才调用的 `safeStorage.getSelectedStorageBackend`。只在本机 Windows 通过不算通过。
- 更新检查的测试替换 `axios.get` 返回 GitHub 响应，HTTP 错误用真实的 `axios.AxiosError` 构造（`tests/updateChecker.test.cjs`）。

## 只测外部行为

- 断言公开入口的输入、输出和落盘结果，不绑定内部函数和调用顺序。例如 `synchronizeMpvConfig` 的测试只看返回值和目录内容。
- 测试走模块已有的公开入口或依赖参数，不为测试新增接缝。
- 文本断言只用于没有运行入口的内容：`resource/login/index.html`、`resource/login/index.js` 和窗口安全选项（`tests/rendererIsolation.test.cjs`）。
- 测试失败时先判断是行为回归还是测试过期，只有测试过期才改断言。

## 配置和工作流

- 配置类改动用 `git grep` 做静态验收，结果只能剩下有意保留的内容。
- 工作流改动要有真实运行记录作为证据，只读 YAML 不算验证。

## Go

- 路由和处理器用 `httptest` 断言响应（`src/modules/proxy/internal/logic/register_test.go`）。
