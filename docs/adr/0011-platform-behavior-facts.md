---
status: accepted
---

# 平台差异的依据

ADR-0006 定了平台差异的写法，这里记各项差异的依据。`PlatformImpl`（`src/public/platform/shared.ts`）是一个平台的全部差异；各平台共有的规则（`MPV_HOME` 优先、自选 MPV 优先、IPC 名字的前缀）在 `index.ts`。实现不读当前平台和文件系统，需要的值（`pathExists`、`isWritableDir`、`os.homedir()`、`app.getPath('appData')`）由调用方传入，测试在任意主机上覆盖三个平台。

## 用户数据目录

默认 `~/.fntv`（`CODING_STANDARDS.md` 的稳定标识）。启动参数带 `--user-data-dir` 时改用它：冒烟测试靠它把用户数据放进临时目录，Windows 上 `app.getPath('home')` 不认 `USERPROFILE`。这是 Chromium 自己的开关，Electron 在 JS 运行前就把 `userData` 改到同一目录，所以不能改名。日志器在 `app.setPath` 之前加载，直接读 `USER_DATA_PATH`（#87）。相对路径按工作目录转成绝对路径，和 Chromium 一致。

## MPV 配置目录（#77，`docs/external-runtime.md`）

按 mpv 的查找规则（mpv 源码 `options/path.c`、`osdep/path-*.c`、`options/configfiles.c`）：

- `MPV_HOME` 优先，各平台都读，也优先于 Windows 的 `portable_config`。空的 `MPV_HOME` 在 mpv 里等于不读用户配置，这里按未设处理，同步仍有地方可写。
- Windows：漫游 AppData 下的 `mpv`（`app.getPath('appData')` 和 mpv 用的 `FOLDERID_RoamingAppData` 是同一个目录），不读 `XDG_CONFIG_HOME` 和 `~/.mpv`。自选的 `mpv.exe` 旁边有 `portable_config` 时 mpv 只读那里（#114）。自选的是 scoop 的 shim（如 `scoop\shims\mpv.exe`）时，mpv 读的是 shim 指向的真实 `mpv.exe` 旁边的 `portable_config`（#262）：shim 旁边有同名的 `.shim` 文本文件，scoop 写入 `path = "<真实 exe 的绝对路径>"`，后面可能还有 `args = …` 行；scoop 自己读回时去掉 `path = ` 和引号（ScoopInstaller/Scoop 的 `lib/core.ps1`，函数 `shim` 和 `Get-ShimTarget`）。这里也接受不带引号、多余空格和 BOM 的写法；没有 `.shim`、没有 `path` 行、路径不是绝对路径或那里没有 `portable_config` 时，按没有 shim 处理。shim 自己旁边的 `portable_config` 仍然优先。读 `.shim` 的函数由调用方注入，和 `pathExists` 一样，平台实现不碰文件系统。附带 MPV 用 `--config-dir` 指向用户配置，否则它读安装目录里的 `portable_config`。
- macOS、Linux：`$XDG_CONFIG_HOME/mpv`（只认绝对路径），否则 `~/.config/mpv`；标准目录不存在而 `~/.mpv` 存在时只读 `~/.mpv`（#115）。这是用户日常用系统 MPV 的目录，所以同步时没有安装记录、也不在历史哈希里的 `mpv.conf` 算用户自己的配置，不写 `.fntv-new`、不算冲突（#219）。

## 运行哪个 MPV

自选 MPV 优先，不检查是否存在；否则 Windows 用附带 MPV（总是有，所以“找不到 MPV”的提示用不到），macOS 和 Linux 取已知位置里第一个存在的。托盘显示和播放用同一个函数，看到的是同一个 MPV。

## MPV IPC 地址

每次播放用唯一的地址（进程号加随机串）。node-mpv-2 默认用固定的 `\\.\pipe\mpvserver` 或 `/tmp/node-mpv.sock`，`start()` 先连这个地址，连上就直接接管，用户自己开着带同名 IPC 的 MPV 或客户端开了两份时会连错。Windows 是命名管道，不落盘；其它平台是 `tmpDir` 下的 Unix socket，播放结束后由调用方删除。socket 路径有字节上限（macOS 的 `sun_path` 104 字节含结尾的 0，Linux 108），超过时改放 `/tmp`。Unix socket 文件只在 MPV 进程退出或 `quit()` 返回后删除：`node-mpv-2` 处理 `seek` 等事件时会按路径另开连接，MPV 还在运行时删掉会让那次连接失败成为未捕获异常；`quit()` 返回时库已断开连接、不再处理事件。

## 窗口和托盘

- 关闭主窗口读的设置：macOS 是 `macCloseAction`（隐藏到状态栏），其它平台是 `exitMode`（最小化到托盘）。macOS 所有窗口关闭后不退出，等 dock 图标重新打开窗口；有 dock 时恢复窗口显示 dock 图标、隐藏到状态栏时隐藏，`activate` 时重建窗口。
- 标题栏：macOS 用系统交通灯按钮（`hiddenInset`），其它平台是无边框窗口加页面里的自定义按钮。
- 主窗口图标：`nativeImage` 只在 Windows 上读 ICO，其它平台用 PNG（#74）。macOS 托盘用模板图标，加载失败时回退到 `icon.png`。
- 托盘恢复窗口的事件：Linux 上激活托盘图标只发 `click`，没有 `double-click`（#75）。

## 凭据

`safeStorage` 后端是 `basic_text` 时拒绝保存凭据，只有 Linux 会落到这个后端。

## 安装包和应用内更新

- 安装包名按 `package.json` 的 `artifactName`（`FNMedia_${version}_${os}_${arch}.${ext}`）拼，没有这个架构的包时是 `null`。Linux 给 x64 的架构名是 `x86_64`（以 v2.7.0 的真实资产核对）。
- 应用内更新只用于打包后的 Windows（NSIS）和 Linux（AppImage）。macOS 的包没有 Developer ID 签名，装不了自动下载的更新。不能更新时原因写进日志，提示框改回手动更新的按钮。
- Linux：electron-updater 删掉 `APPIMAGE` 指向的文件，把新 AppImage 移到同一目录，所以要以 AppImage 运行（解包后运行时没有 `APPIMAGE`），并且这个目录可写。
