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
- **直链播放** - 适配官方直链和 STRM 播放，默认使用 302 重定向，可以在托盘处调整为 NAS 代理模式
- **进度回传** - MPV 播放器支持实时将进度回传到飞牛服务器
- **弹幕支持** - MPV 播放器支持弹幕自动匹配加载，无法匹配时支持手动搜索
- **视频增强** - 内置 Anime4K 着色器以及对应预设模式
- **智能跳过** - 可在 MPV 播放器界面设置。支持三种跳过片头片尾模式：章节检查，手动设置片头片尾，快捷键跳过固定时长
- **跨平台支持** - 支持 Windows、macOS 和 Linux

## 📦 安装方法

### 构建产物

本仓库暂无公开 Release，请按下文[从源码构建](#从源码构建)自行构建，产物在 `release/` 目录：

- 文件名：`FNMedia_${version}_${os}_${arch}.${ext}`

1. 字段含义：

- `version`：版本号
- `os`：操作系统
- `arch`：系统架构
- `ext`：文件扩展名

2. 安装步骤：

- Windows 直接安装即可使用。
- macOS 请使用 Homebrew 安装 MPV：

```bash
brew install mpv
# 安装 DMG 后执行
sudo find "/Applications/飞牛影视.app" -exec xattr -d com.apple.quarantine {} \; 2>/dev/null
```

- Linux 请先安装 MPV 播放器（版本 > 0.37.0）再使用，插件前往 [fntv-mpv](https://github.com/JayYa/fntv-mpv-config/releases) 自行安装。

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

`third_party/fntv-mpv` 不入库，开发运行和打包都依赖它。从固定版本的 [fntv-mpv-config Release](https://github.com/JayYa/fntv-mpv-config/releases/tag/fntv-mpv-v20260826_013404) 下载归档，解压到这个目录：

```bash
curl -fL -o mpv-config.zip https://github.com/JayYa/fntv-mpv-config/releases/download/fntv-mpv-v20260826_013404/mpv-package-20260825_173358.zip
mkdir -p third_party/fntv-mpv
unzip -q mpv-config.zip -d third_party/fntv-mpv
rm mpv-config.zip
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
   打开安装目录的 `third_party`，只修改 `third_party\fntv-mpv\portable_config` 下面的插件，其余的不要动。其中 `input.conf` 是快捷键配置。

注意重新安装或者更新，会清空安装目录，注意备份你的 MPV 插件目录。

### 2. 能否支持 PotPlayer？

目前我这边没有使用 PotPlayer 的需求。如果需要，可以自行修改源码适配，代码已留好接口。

### 3. 弹幕相关问题？

弹幕问题查看 `uosc_danmaku` 的文档，根据文档内容调整配置。

### 4. 登录完客户端后，如果服务器连接不上登录会超时卡透明屏，无法切换或修改服务器配置，卸载重装也不行

删除 `C:\Users\{你的计算机用户名}\.fntv` 下面的 `config.json`。因为连接成功后实际上加载的还是飞牛网页端，没响应当然会透明了。

### 5. 打开弹幕视频掉帧

打开弹幕时，默认开启 FPS 平滑滤镜，比较吃性能。不需要时，可以在安装目录的 `third_party\fntv-mpv\portable_config\script-opts\uosc_danmaku.conf` 里关闭相关配置。

### 6. 视频播放卡慢，双显卡，调用时发现使用核显

以下两种方法任选其一：

1. NVIDIA 控制面板 > 管理 3D 设置 > 程序设置 > 添加飞牛影视 > 应用
2. 设置 > 系统 > 屏幕 > 图形显示 > 添加飞牛影视 > 选择高性能

## ⌨️ MPV 播放器

1. 快捷键

```text
部分快捷键兼容 PotPlayer
查看安装目录下
third_party\fntv-mpv\portable_config\input.conf
```

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
