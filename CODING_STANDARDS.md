# 编码标准

每条规则都给出本仓库内的依据，新增规则也要能这样验证。

改打包的 MPV、MPV 配置同步、默认播放方式或 Proxy 生命周期时，读 `docs/external-runtime.md`。改访问码流程时，读 `docs/adr/0002-access-code-gateway-session.md`。

## 稳定标识

下面这些标识绑定已安装用户的数据或构建链路，保持原值，改品牌和迁移维护者时也一样。

| 标识 | 位置 | 不改的理由 |
| --- | --- | --- |
| `name`（`fntv`） | `package.json` | 决定应用名。Electron `safeStorage` 在 macOS 和 Linux 上按应用名找密钥，改名后可能解不开已保存的凭据，`readConfig` 随之抛错（`src/modules/fn_config/config.ts`）。 |
| `productName`（`飞牛影视`） | `package.json` 的 `build` | 打包后它决定应用名，风险同 `name`；安装目录和快捷方式名也随之改变。 |
| `appId`（`com.qiaokes.fntv`） | `package.json` 的 `build` | 打包工具用它生成 macOS bundle id 和 Windows 安装标识。改了会变成另一个应用，而不是升级。 |
| `~/.fntv` | `USER_DATA_PATH`（`src/public/constants.ts`） | 是 `userData` 目录，放 `config.json`、`proxy-secret` 和 Chromium 会话。改了等于丢配置，已运行的 Proxy 也认证不了。 |
| `persist:fntv` | `src/main/common/mainwin.ts` 等，用 `git grep` 找全 | 登录 Cookie 和访问码网关 Cookie 存在这个分区。改了用户要重新登录；只改一处则读写的不是同一个会话。 |
| `third_party/fntv-mpv` | `package.json` 的 `extraFiles`、`mpvConfigHelpers.ts`、`release.yml` | 构建、打包和运行时都按这个路径找 MPV。 |
| `FNMedia_*` 产物名 | `package.json` 的 `artifactName` | `src/modules/updater/updateChecker.ts` 按这个前缀和 `_win_x64` 这类后缀匹配下载链接。 |
| 旧版解密密钥 `ENCRYPTION_KEY` | `src/modules/fn_config/config.ts` | 只用来读取旧版本加密的历史密码，读出后迁移到 `safeStorage`。改掉后这些密码解不开（`tests/credentialStorage.test.cjs`）。 |

## 进程边界

- 窗口保持 `nodeIntegration: false`、`contextIsolation: true`（`mainwin.ts`、`fnid_login.ts`，`tests/rendererIsolation.test.cjs`）。
- 本地页面只通过 `window.electronAPI` 访问主进程。这个桥只暴露给 `file:` 页面，远程页面拿不到（`src/preload/index.ts`）。
- 新增 IPC 频道时加进 `src/preload/index.ts` 的 `SEND_CHANNELS` 或 `RECEIVE_CHANNELS`。
- 长期 token 留在主进程，`config-data` 只发表单回填字段（`src/main/handlers/plugins/auth.ts`）。
- 需要用户确认或输入时走主进程的 `dialog`，或用页面内组件，浏览器原生弹窗在 Electron 里不可靠。验证：`git grep -n -E '(alert|confirm|prompt)(' -- src resource` 没有结果。
- 登录页的外链写成 `class="github-link"`，地址用 `https://github.com`，`<a>` 里只放文字。`openExternal` 只放行这个域（`src/preload/index.ts`），点击处理靠 `e.target` 的 class 识别链接，放子元素后点击不到（`resource/login/index.html`，`tests/accessCodeLoginPage.test.cjs`）。

## 署名

- `package.json` 显式设置 `build.copyright`，这一行同时写原作者和修改声明。不设时打包工具可能从 `author` 派生版权行，抹掉原作者。
- `README.md` 的原作者版权行 `Copyright (c) 2025 Tag mig hånden` 和 `LICENSE` 保持原样，修改声明另起一行。
- 验证：`git grep -n 'Tag mig hånden' -- package.json README.md resource/login/index.html` 三个文件都有结果。

## 网络

- 依赖 `persist:fntv` 会话 Cookie 的请求用 Electron `net`（`src/main/common/accessCodeSession.ts`）。
- FNMedia API 和更新检查走 `axios`，也就是 Node 网络栈，不走 Chromium（`src/modules/fn_api/request.ts`、`updateChecker.ts`）。
- 页面能打开但主进程请求失败时，先查这个差异：系统代理、VPN 和证书在两个网络栈里表现不同。

## 更新检查

- 更新源只在 `updateChecker.ts` 的 `UPDATE_REPOSITORY` 改。
- GitHub 返回 404 表示仓库还没有 Release，按 `hasUpdate: false` 处理，不重试，不报错。其它失败照常重试并提示（`tests/updateChecker.test.cjs`）。
- 安装包匹配按打包工具的真实架构名写：Linux x64 的 AppImage 产物名是 `x86_64`，不是 `x64`。

## 凭据

- 落盘的凭据走 `config.ts` 的 `writeConfig`，由 `encryptCredential` 加密。新增凭据字段时，同时补上读写两边。
- Linux 上 `safeStorage` 后端是 `basic_text` 时拒绝保存，不降级为明文。
- Proxy 密钥、访问码、token 和播放 `session` 不进日志、URL、命令行参数和环境变量。例外是播放 URL 里的 `session`，它本身就是短期能力，记录时要脱敏（`src/modules/logger/masking.ts`，`tests/sessionMasking.test.cjs`）。

## 跨层改动

- 改字段含义前，用 `git grep` 找全读写处，改完再搜一遍。`hideOriginalPlayButton` 同时被主进程、preload 和登录页读取，默认值必须一致（`docs/external-runtime.md`）。
- TS 和 Go 之间的契约两端一起改：
  - `PlaybackSessionInput`（`proxySession.ts`）和 `PlaybackSessionRequest`（`session.go`）的 JSON 字段。
  - `composeCookieHeader`（`accessGrant.ts`）和 `ComposeCookieHeader`（`request.go`）。
  - `/health` 的 `service`、`protocol`（`proxyHealth.ts`、`register.go`）。

## 依赖

- `pnpm-lock.yaml` 入库，改 `package.json` 的依赖时在同一个提交里更新。工作流用 `pnpm install --frozen-lockfile`，两者不一致时安装直接失败。验证：`git grep -n 'pnpm install' -- .github/workflows` 每行都有 `--frozen-lockfile`。
- pnpm 版本只写在 `package.json` 的 `packageManager`，`pnpm/action-setup` 读这个字段，工作流不另写一份。验证：`git grep -n -A2 'pnpm/action-setup' -- .github/workflows` 没有 `version:`。
- pnpm 配置写在 `pnpm-workspace.yaml`，`.npmrc` 只放 `registry`。pnpm 不读 `.npmrc` 里的 `node-linker`，也不把 `electron_mirror` 传给安装脚本；CI 还会删掉 `.npmrc`。验证：`pnpm config get nodeLinker` 输出 `hoisted`。
- `nodeLinker` 保持 `hoisted`，这个布局打包出的生产依赖和迁移前一致。改依赖布局时解开产物的 `app.asar`，核对 `node_modules` 里生产依赖齐全，构建成功不算验证。
- 有安装脚本的依赖要在 `allowBuilds` 里写明，否则 `pnpm install` 报 `ERR_PNPM_IGNORED_BUILDS` 并跳过脚本。`electron` 必须放行，它的 postinstall 下载二进制。验证：`node_modules/electron/path.txt` 存在。
- 保留 `extract-zip>yauzl` 的 override，等 `extract-zip` 改用 `yauzl` 3 后再去掉。`yauzl` 2.10 在 Node 26 上读不出 zip 内容，进程却以 0 退出，`electron` 的 postinstall 显示成功，留下只有空 `locales` 的 `dist`。

## GitHub Workflow

- 提交信息、PR 标题、分支名这类不可信内容先放进 `env:`，再在 shell 里用 `"$VAR"` 读取。范例是 `release.yml` 的 `Select build matrix` 步骤（`PLATFORM`）。
- 第三方 action 固定到 commit SHA，行尾注释版本号（`ci.yml`、`release.yml`）。
- Go 版本用 `go-version-file: src/modules/proxy/go.mod` 读取。
- 工作流权限只给 `contents: read`。`release.yml` 只手动触发，产物留在 Actions artifacts。
- `package.json` 里每条 `electron-builder` 打包命令都带 `--publish never`。不写时它在 CI 上按 `repository` 隐式发布到 GitHub。验证：`git grep -n 'electron-builder --' -- package.json` 每行都有 `--publish never`。
- 构建依赖的外部资产固定 tag 和 sha256（`release.yml` 的 `Download third-party dependencies`）。
- `ci.yml` 的 `pull_request` 不按 `branches` 过滤，堆叠 PR 的 base 不是 `main`，也要跑。
- 验证：`git grep -n -E 'head_commit|releases/latest|secrets\.' -- .github/workflows` 没有结果。

## 文档

- 中文和英文、数字之间加一个空格，行内代码和链接的两侧也一样。中文句子用全角标点。
- 产品名用官方写法：Windows、macOS、Linux、PotPlayer、Anime4K、NAS。说播放器时写 MPV，只有命令才写 `mpv`。
- 文件名、路径和配置项放进行内代码。
- 验证：`LC_ALL=C.UTF-8 grep -nP '\p{Han}[A-Za-z0-9]|[A-Za-z0-9]\p{Han}' README.md` 只剩代码块和链接锚点里的内容。

## 提交

格式是 `type(scope): 描述`，描述用中文，一个提交只做一件事。PR 标题用同样的格式。

- `type`：`feat`、`fix`、`docs`、`refactor`、`test`、`chore`。
- `scope`：受影响的模块或领域，例如 `player`、`media`、`playback`、`agents`。没有明确模块时可以省略。
