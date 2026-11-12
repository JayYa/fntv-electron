import * as path from 'node:path';

/**
 * 平台差异集中在这里：维护者只有 Windows，散在各处的 macOS 和 Linux 分支在本机跑不到。
 * 读取 process.platform 和 process.arch 只在本文件发生（eslint.config.mjs 的 no-restricted-properties），其它模块用 currentPlatform() 取得当前平台，再把它传给下面的纯函数。
 * 纯函数接收平台参数，测试可以在任意主机上覆盖 Windows、macOS 和 Linux 三条分支（tests/platform.test.cjs）。
 *
 * currentPlatform() 每次调用时读取，不缓存：已有测试通过改写 process.platform 模拟其它平台。
 */

export function currentPlatform(): NodeJS.Platform {
    return process.platform;
}

export function currentArch(): string {
    return process.arch;
}

/** 关闭主窗口时读哪项设置：macOS 是 macCloseAction（隐藏到状态栏），其它平台是 exitMode（最小化到托盘）。 */
export type CloseBehaviorSetting = 'macCloseAction' | 'exitMode';

export interface PlatformBehavior {
    /** 关闭主窗口时读哪项设置，也决定托盘菜单显示“关闭行为设置”还是“退出行为设置”。 */
    closeBehaviorSetting: CloseBehaviorSetting;
    /** 所有窗口关闭后是否退出应用。macOS 保持运行，等 dock 图标重新打开窗口。 */
    quitsWhenAllWindowsClosed: boolean;
    /** 有 dock：恢复窗口时显示 dock 图标，隐藏到状态栏时隐藏，activate 时重建窗口。 */
    hasDock: boolean;
    /** macOS 用系统交通灯按钮（hiddenInset），其它平台是无边框窗口加页面里的自定义按钮。 */
    titleBar: 'hiddenInset' | 'frameless';
    /** build/ 下的主窗口图标文件。Electron 的 nativeImage 只在 Windows 上读 ICO，其它平台用 PNG（#74）。 */
    windowIcon: 'icon.ico' | 'icon.png';
    tray: {
        showWindowLabel: string;
        quitLabel: string;
        /** 哪个托盘事件恢复窗口。Linux 上用户激活托盘图标时发 click，没有 double-click（#75）。 */
        restoreEvent: 'click' | 'double-click';
        /** build/ 下的图标文件。template 为 true 时是 macOS 模板图标，加载失败时回退到 icon.png。 */
        icon: { file: string; template: boolean };
        /** 最小化到托盘后是否弹出一次气泡提示。 */
        showsMinimizeBalloon: boolean;
    };
    /** 选择 MPV 播放器时“可执行文件”过滤器的扩展名。 */
    mpvExecutableExtensions: string[];
    /** 播放时找不到 MPV 的提示。Windows 总有附带 MPV，用不到这条。 */
    mpvNotFoundMessage: string;
    /** safeStorage 后端是 basic_text 时拒绝保存凭据。只有 Linux 会落到这个后端。 */
    rejectsBasicTextStorage: boolean;
}

export function platformBehavior(platform: NodeJS.Platform = currentPlatform()): PlatformBehavior {
    const isMac = platform === 'darwin';
    const isWindows = platform === 'win32';
    return {
        closeBehaviorSetting: isMac ? 'macCloseAction' : 'exitMode',
        quitsWhenAllWindowsClosed: !isMac,
        hasDock: isMac,
        titleBar: isMac ? 'hiddenInset' : 'frameless',
        windowIcon: isWindows ? 'icon.ico' : 'icon.png',
        tray: {
            showWindowLabel: isMac ? '显示窗口' : '显示主窗口',
            quitLabel: isMac ? '退出飞牛影视' : '退出',
            restoreEvent: isWindows ? 'double-click' : 'click',
            icon: isMac
                ? { file: 'iconTemplate2.png', template: true }
                : { file: isWindows ? 'icon.ico' : 'icon.png', template: false },
            showsMinimizeBalloon: isWindows,
        },
        mpvExecutableExtensions: isWindows ? ['exe'] : [],
        mpvNotFoundMessage: isMac
            ? 'macOS平台未找到mpv播放器，请使用Homebrew安装mpv后重试: brew install mpv'
            : 'Linux平台未找到mpv播放器，请安装mpv播放器后重试',
        rejectsBasicTextStorage: platform === 'linux',
    };
}

export interface UserDirs {
    /** os.homedir()。 */
    homeDir: string;
    /** app.getPath('appData')。Windows 上是漫游 AppData，与 mpv 用的 FOLDERID_RoamingAppData 是同一个目录。 */
    appDataDir: string;
}

/**
 * 用户 MPV 配置目录，按 mpv 的查找规则（#77，docs/external-runtime.md；mpv 源码 options/path.c、osdep/path-unix.c、
 * osdep/path-win.c）：MPV_HOME 优先，各平台都读；否则 Windows 是漫游 AppData 下的 mpv，其它平台是
 * $XDG_CONFIG_HOME/mpv（mpv 只认绝对路径），否则 ~/.config/mpv。
 * 空的 MPV_HOME 在 mpv 里等于不读用户配置，这里按未设处理，同步仍有地方可写。
 * Windows 上用户自己指定的 mpv.exe（userMpvPath）旁边有 portable_config 时，mpv 只读那里（#114）；
 * MPV_HOME 优先于它（options/path.c 的 mp_init_paths）。打包的 mpv 有 --config-dir，不传 userMpvPath。
 * 其它平台上标准目录不存在而 ~/.mpv 存在时，mpv 只读 ~/.mpv；两者都在时以标准目录为准（#115，
 * osdep/path-unix.c、osdep/path-darwin.c、options/configfiles.c）。Windows 不读 ~/.mpv。
 * pathExists 由调用方传入（通常是 fs.existsSync），本函数不碰文件系统，测试可以用临时目录或假函数。
 * scoop 之类的 shim 不在真实 mpv.exe 旁边，按 shim 所在目录找不到 portable_config，这里不处理。
 */
export function mpvUserConfigDir(
    platform: NodeJS.Platform,
    dirs: UserDirs,
    env: Record<string, string | undefined>,
    userMpvPath: string | undefined,
    pathExists: (target: string) => boolean,
): string {
    if (env.MPV_HOME) {
        return env.MPV_HOME;
    }
    if (platform === 'win32') {
        if (userMpvPath) {
            const portableDir = path.win32.join(path.win32.dirname(userMpvPath), 'portable_config');
            if (pathExists(portableDir)) {
                return portableDir;
            }
        }
        return path.win32.join(dirs.appDataDir, 'mpv');
    }
    const xdgConfigHome = env.XDG_CONFIG_HOME;
    const configHome = xdgConfigHome?.startsWith('/') ? xdgConfigHome : path.posix.join(dirs.homeDir, '.config');
    const standardDir = path.posix.join(configHome, 'mpv');
    const legacyDir = path.posix.join(dirs.homeDir, '.mpv');
    if (!pathExists(standardDir) && pathExists(legacyDir)) {
        return legacyDir;
    }
    return standardDir;
}

/** 没有自选 MPV 时，macOS 和 Linux 依次检查的 mpv 位置。 */
const MPV_SEARCH_PATHS: Partial<Record<NodeJS.Platform, string[]>> = {
    darwin: [
        '/opt/homebrew/bin/mpv',                     // Apple Silicon 上的 Homebrew
        '/usr/local/bin/mpv',                        // Intel 上的 Homebrew 或手动安装
        '/Applications/mpv.app/Contents/MacOS/mpv',  // App bundle
    ],
    linux: [
        '/usr/bin/mpv',       // 系统包管理器
        '/usr/local/bin/mpv', // 手动编译安装
        '/snap/bin/mpv',      // Snap
        '/usr/games/mpv',     // 某些发行版
        '/opt/mpv/bin/mpv',   // 可选安装位置
    ],
};

export interface MpvPlayer {
    path: string;
    /** 是附带 MPV。播放时要用 --config-dir 把它指向用户配置，否则它读安装目录里的 portable_config。 */
    bundled: boolean;
}

/**
 * 客户端这次会运行的 MPV：自选 MPV 优先，不检查它是否存在；否则 Windows 用附带 MPV（同样不检查），
 * macOS 和 Linux 取 MPV_SEARCH_PATHS 里第一个存在的。找不到时返回 undefined，由调用方决定是否提示。
 * 托盘显示和播放都用它，两处看到的是同一个 MPV。pathExists 通常是 fs.existsSync。
 */
export function mpvPlayer(
    platform: NodeJS.Platform,
    userMpvPath: string | undefined,
    bundledMpvPath: string,
    pathExists: (target: string) => boolean,
): MpvPlayer | undefined {
    if (userMpvPath) {
        return { path: userMpvPath, bundled: false };
    }
    if (platform === 'win32') {
        return { path: bundledMpvPath, bundled: true };
    }
    const found = (MPV_SEARCH_PATHS[platform] ?? []).find(pathExists);
    return found ? { path: found, bundled: false } : undefined;
}

/** MPV JSON IPC 的地址。isFile 为 true 时它是文件系统里的 Unix socket，播放结束后由调用方删除。 */
export interface MpvIpcSocket {
    path: string;
    isFile: boolean;
}

/** Unix socket 路径的字节上限：macOS 的 sun_path 是 104 字节（含结尾的 0），Linux 是 108。 */
const UNIX_SOCKET_PATH_MAX_BYTES = 103;

/**
 * 一次播放用的 MPV IPC 地址，id 由调用方保证唯一（进程号加随机串）。node-mpv-2 默认用固定的
 * \\.\pipe\mpvserver 或 /tmp/node-mpv.sock，start() 先连这个地址，连上 MPV 就直接接管，
 * 用户自己开着带同名 IPC 的 MPV 或客户端开了两份时会连错。
 * Windows 是命名管道，不落盘；其它平台放在 tmpDir 下，超过 sun_path 上限时 MPV 绑定不了，改放 /tmp。
 */
export function mpvIpcSocket(platform: NodeJS.Platform, tmpDir: string, id: string): MpvIpcSocket {
    const name = `fntv-mpv-${id}`;
    if (platform === 'win32') {
        return { path: `\\\\.\\pipe\\${name}`, isFile: false };
    }
    const socketPath = path.posix.join(tmpDir, `${name}.sock`);
    if (Buffer.byteLength(socketPath) <= UNIX_SOCKET_PATH_MAX_BYTES) {
        return { path: socketPath, isFile: true };
    }
    return { path: path.posix.join('/tmp', `${name}.sock`), isFile: true };
}

/** 能不能做应用内更新。不能时 reason 写进日志，提示框改回手动更新的按钮。 */
export type InAppUpdateAvailability = { available: true } | { available: false; reason: string };

/**
 * 应用内更新用于打包后的 Windows（NSIS）和 Linux（AppImage）客户端。macOS 的包没有 Developer ID 签名，装不了。
 * Linux 上 electron-updater 删掉 APPIMAGE 指向的文件，把新 AppImage 移到同一目录，所以要以 AppImage 运行
 * （appImagePath 是 APPIMAGE 环境变量，解包后运行时没有），并且这个目录可写。
 * isWritableDir 由调用方传入（通常用 fs.accessSync 的 W_OK），本函数不碰文件系统。
 */
export function inAppUpdateAvailability(
    platform: NodeJS.Platform,
    isPackaged: boolean,
    appImagePath: string | undefined,
    isWritableDir: (dir: string) => boolean,
): InAppUpdateAvailability {
    if (platform !== 'win32' && platform !== 'linux') {
        return { available: false, reason: `${platform} 不支持应用内更新` };
    }
    if (!isPackaged) {
        return { available: false, reason: '未打包的客户端不做应用内更新' };
    }
    if (platform === 'linux') {
        if (!appImagePath) {
            return { available: false, reason: '没有以 AppImage 运行（APPIMAGE 未设置），不做应用内更新' };
        }
        const appImageDir = path.posix.dirname(appImagePath);
        if (!isWritableDir(appImageDir)) {
            return { available: false, reason: `AppImage 所在目录不可写：${appImageDir}` };
        }
    }
    return { available: true };
}
