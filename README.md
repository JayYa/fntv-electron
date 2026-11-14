# fntv-electron 桌面客户端

飞牛影视桌面客户端，基于 Electron 构建，提供更好的桌面体验和增强功能。

> 本仓库是 [QiaoKes/fntv-electron](https://github.com/QiaoKes/fntv-electron) 的修改版。

<img src="resource/docs/switch.png" width="90%">
<img src="resource/docs/simple.png" width="90%">

[演示视频](https://www.bilibili.com/video/BV12dYXzhE6U/)

## ✨ 主要功能

- **原生桌面体验** - 基于飞牛影视 Web 端构建的桌面应用，提供类原生体验
- **多账户管理** - 支持自动登录，支持多账户管理，自由切换账户和服务器
- **远程访问** - 支持使用 FN Connect，通过 FN ID 登录实现远程访问
- **硬解播放** - 使用 MPV 播放器，支持 H264、HEVC、VP9、AV1 等编码格式
- **直链播放** - 适配官方直链和 STRM，默认由客户端直接向直链地址取流（直链直连），可在托盘菜单打开“NAS 中转 网盘/STRM”
- **进度回传** - MPV 播放器支持实时将进度回传到飞牛服务器
- **弹幕支持** - MPV 播放器支持弹幕自动匹配加载，无法匹配时支持手动搜索
- **视频增强** - 内置 Anime4K 着色器以及对应预设模式
- **智能跳过** - 可在 MPV 播放器界面设置。支持三种跳过片头片尾模式：章节检查，手动设置片头片尾，快捷键跳过固定时长
- **跨平台支持** - 支持 Windows、macOS 和 Linux

## 📦 安装方法

### 下载安装包

正式版发布在 [Releases](https://github.com/JayYa/fntv-electron/releases)，选对应平台的文件下载。也可以按下文[从源码构建](#从源码构建)，产物在 `release/` 目录。

系统要求：Windows 10 及以上（x64）；macOS 13（Ventura）及以上，macOS 12 只能用 2.8.x 及更早的版本；Linux x64、arm64。

- 文件名：`FNMedia_${version}_${os}_${arch}.${ext}`

1. 字段含义：

- `version`：版本号
- `os`：操作系统
- `arch`：系统架构
- `ext`：文件扩展名

2. 安装步骤：

- Windows 直接安装即可使用。
- macOS 需要自己安装 MPV，推荐用 Homebrew：

```bash
brew install mpv
# 安装 DMG 后执行
sudo find "/Applications/飞牛影视.app" -exec xattr -d com.apple.quarantine {} \; 2>/dev/null
```

- Linux 需要自己安装 MPV 播放器（版本 > 0.37.0）。AppImage 下载后按顺序做：
  1. 把文件改成不带版本号的名字，例如 `FNMedia.AppImage`。文件名里不能出现 `3.2.0` 这种三段数字，出现了就算带版本号。
  2. 执行 `chmod +x FNMedia.AppImage` 加上可执行权限。
  3. 再建桌面快捷方式、`.desktop` 文件或开机自启项，指向改名后的文件。

  这样之后的应用内更新会原地替换这个文件，快捷方式一直有效。保留带版本号的文件名的话，每次应用内更新后文件名都会变成新版本号，快捷方式要重新指向新文件。

macOS 和 Linux 的安装包不带 MPV 播放器，只带 MPV 插件和配置。客户端每次启动会把它们同步到 `~/.config/mpv`（设了 `XDG_CONFIG_HOME` 时是 `$XDG_CONFIG_HOME/mpv`，设了 `MPV_HOME` 时是它本身，和 MPV 读取配置的目录一致），不用自己装插件：

- 插件、字体、着色器和默认值 `fntv/defaults.conf` 由客户端管理，每次启动换成新版，改了也会被覆盖。插件目录里你自己放的其它文件保留。
- `mpv.conf`、`input.conf` 和 `script-opts` 下的配置：缺的补上；你没改过的换成新版；你改过的不动，新版写在旁边的 `<文件名>.fntv-new`，客户端提示一次，托盘“设置”里会显示待合并的数量。合并完删掉 `.fntv-new` 即可。
- 弹幕历史 `danmaku-history.json` 只在缺失时复制，不会被覆盖。
- macOS 和 Linux 上，如果 `mpv.conf` 是你自己原有的（不是客户端装的），客户端不动它，也不提示合并。想用客户端的默认值，在它开头加上 `include="~~/fntv/defaults.conf"` 和 `profile=fntv-defaults` 两行。

Windows 的安装包附带 MPV，但它不读安装目录里的配置：客户端启动它时用 `--config-dir` 指向用户 MPV 配置目录 `%APPDATA%\mpv`（设了 `MPV_HOME` 时是它本身）。安装目录里的 `third_party\fntv-mpv\portable_config` 只是同步的来源，同步规则和上面一样（`mpv.conf` 的例外只在 macOS 和 Linux 上有）。在托盘菜单的“设置”里点“打开 MPV 用户配置目录”，打开的就是 MPV 实际读取的目录（三个平台都有这一项）。

发现新版本时，Windows 和 Linux（以 AppImage 运行时）可以在客户端内下载并安装；macOS 仍然打开下载链接，需要自己下载安装。更新默认直连 GitHub；GitHub 下载慢时，可以在托盘菜单的“设置”里打开“应用更新下载加速”，应用内更新和下载链接都会经第三方 `gh-proxy.com` 中转，加速地址可在登录页右上角的“通用设置”里修改。

### 安装包没有签名

安装包没有代码签名，macOS 版也没有经过 Apple 公证，首次打开时系统会拦截：

- Windows：SmartScreen 提示“Windows 已保护你的电脑”。点“更多信息”，再点“仍要运行”。
- macOS：Gatekeeper 提示“无法验证开发者”或“已损坏，无法打开”。先把应用拖进“应用程序”，然后任选一种：
  - 打开“系统设置 → 隐私与安全性”，在页面下方找到被拦截的“飞牛影视”，点“仍要打开”。
  - 在终端执行上面的 `xattr` 命令，去掉下载时加上的隔离标记。

只从本仓库的 Releases 下载安装包。来源不明的安装包同样会出现这些提示，提示本身不能证明文件可信。

### 从源码构建

1. 克隆仓库：

```bash
git clone https://github.com/JayYa/fntv-electron.git
cd fntv-electron
```

2. 安装依赖：

依赖用 pnpm 管理，版本固定在 `package.json` 的 `packageManager`。下载 Electron 走国内镜像时，先设置环境变量 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`，`.npmrc` 里的 `electron_mirror` 对 pnpm 无效。

```bash
pnpm install
```

3. 准备 MPV：

`third_party/fntv-mpv` 不入库，开发运行和打包都依赖它。从固定版本的 [fntv-mpv-config Release](https://github.com/JayYa/fntv-mpv-config/releases/tag/fntv-mpv-v20261114_235035) 下载归档，解压到这个目录：

```bash
curl -fL -o mpv-config.zip https://github.com/JayYa/fntv-mpv-config/releases/download/fntv-mpv-v20261114_235035/mpv-package-20261114_235035.zip
mkdir -p third_party/fntv-mpv
unzip -q mpv-config.zip -d third_party/fntv-mpv
rm mpv-config.zip
```

Windows 上用 PowerShell 的 `Expand-Archive` 解压，和 CI 一样。Git Bash 的 `unzip` 会把归档里的 `mpv/` 目录和 `mpv.exe` 当成同一个名字，`mpv/fonts.conf` 解压不出来：

```powershell
Expand-Archive -Path mpv-config.zip -DestinationPath third_party/fntv-mpv -Force
```

4. 运行开发模式：

```bash
pnpm start
```

5. 构建安装包：

```bash
pnpm run build:win
pnpm run build:mac
pnpm run build:linux
```

## 常见问题

### 1. MPV 播放器功能有点少，怎么客制化，想添加补帧滤镜等？

1. 自动方法
   克隆 fntv-mpv 仓库，自己改一下相关配置：[fntv-mpv-config](https://github.com/JayYa/fntv-mpv-config)
2. 手动方法
   在托盘菜单的“设置”里点“打开 MPV 用户配置目录”（Windows 通常是 `%APPDATA%\mpv`，macOS 和 Linux 通常是 `~/.config/mpv`），在这里改配置。`mpv.conf` 是播放器配置，你的设置写在 `profile=fntv-defaults` 那行后面，会盖过客户端的默认值；`input.conf` 是快捷键配置，`script-opts` 下是各插件的选项。

不要改安装目录 `third_party\fntv-mpv\portable_config` 里的文件：MPV 不读它，它只是同步的来源，重新安装或者更新还会清空它。用户配置目录里，插件、字体、着色器和 `fntv/defaults.conf` 每次启动都会被换成新版，改了会丢；配置文件你改过的不会被覆盖，新版会写成 `.fntv-new` 等你合并（同步规则见上文“下载安装包”）。

### 2. 能否支持 PotPlayer？

目前我这边没有使用 PotPlayer 的需求。如果需要，可以自行修改源码适配，代码已留好接口。

### 3. 弹幕相关问题？

弹幕问题查看 `uosc_danmaku` 的文档，根据文档内容调整配置。

### 4. 登录完客户端后，如果服务器连接不上登录会超时卡透明屏，无法切换或修改服务器配置，卸载重装也不行

删除 `C:\Users\{你的计算机用户名}\.fntv` 下面的 `config.json`。因为连接成功后实际上加载的还是飞牛网页端，没响应当然会透明了。

### 5. 打开弹幕视频掉帧

打开弹幕时，默认开启 FPS 平滑滤镜，比较吃性能。不需要时，可以在用户 MPV 配置目录（托盘菜单“设置” > “打开 MPV 用户配置目录”）的 `script-opts\uosc_danmaku.conf` 里关闭相关配置。

### 6. 视频播放卡慢，双显卡，调用时发现使用核显

以下两种方法任选其一：

1. NVIDIA 控制面板 > 管理 3D 设置 > 程序设置 > 添加飞牛影视 > 应用
2. 设置 > 系统 > 屏幕 > 图形显示 > 添加飞牛影视 > 选择高性能

### 7. 日志在哪里？

日志文件是 `app.log`，在用户目录下的 `.fntv/logs` 里。超过大小后会轮转成 `app-<时间>.log`，留在同一目录。

| 平台 | 日志目录 |
| --- | --- |
| Windows | `C:\Users\{你的计算机用户名}\.fntv\logs` |
| macOS | `~/.fntv/logs` |
| Linux | `~/.fntv/logs` |

旧版本把日志写在另一个目录：Windows 是 `%APPDATA%\fntv\logs`，macOS 是 `~/Library/Application Support/fntv/logs`，Linux 是 `~/.config/fntv/logs`。升级后旧日志留在原处，不再更新，可以手动删除。

## ⌨️ MPV 播放器

1. 快捷键

   部分快捷键兼容 PotPlayer，见用户 MPV 配置目录（托盘菜单“设置” > “打开 MPV 用户配置目录”）下的 `input.conf`。

2. MPV 配置由以下仓库单独管理：
   [fntv-mpv-config](https://github.com/JayYa/fntv-mpv-config)
3. 预设着色器方案
   [mpv.conf](https://github.com/JayYa/fntv-mpv-config/blob/release/custom_config/mpv/mpv.conf)

## 🙏 特别感谢

本项目参考以下开源项目：

- [enable-chromium-hevc-hardware-decoding](https://github.com/StaZhu/enable-chromium-hevc-hardware-decoding) - Chromium HEVC 硬解码支持
- [electron-media-patch](https://github.com/5rahim/electron-media-patch) - Electron 硬解码补丁
- [fnToPotplayer](https://github.com/gudqs7/fnToPotplayer) - 飞牛影视调用 PotPlayer
- [fnos-tv](https://github.com/thshu/fnos-tv) - fnos-tv 支持弹幕的飞牛影视
- [MPV 弹幕插件](https://github.com/Tony15246/uosc_danmaku) - `uosc_danmaku`，基于 uosc 的弹幕插件

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=JayYa/fntv-electron&type=date&legend=top-left)](https://www.star-history.com/#JayYa/fntv-electron&type=date&legend=top-left)

## 📄 许可证

本项目采用 [GPL-3.0 许可证](LICENSE)

Copyright (c) 2025 Tag mig hånden

修改声明：本仓库是原作者作品的修改版，修改始于 2026 年，修改部分同样按 GPL-3.0 发布。

---

**温馨提示**：本项目为第三方客户端，与飞牛影视官方无关。使用前请确保遵守相关服务条款。
