import { darwin } from './darwin';
import { linux } from './linux';
import { InAppUpdateAvailability, MpvIpcSocket, MpvPlayer, PlatformBehavior, PlatformImpl, UserDirs } from './shared';
import { win32 } from './win32';

export type { CloseBehaviorSetting, InAppUpdateAvailability, MpvIpcSocket, MpvPlayer, PlatformBehavior, UserDirs } from './shared';

/**
 * 平台差异集中在这个目录：维护者只有 Windows，散在各处的 macOS 和 Linux 分支在本机跑不到（docs/adr/0006）。
 * 每个平台一个文件（win32.ts、darwin.ts、linux.ts），实现 shared.ts 的 PlatformImpl；macOS 和 Linux 共用的逻辑在 posix.ts。
 * 本文件按平台查表取实现，这是唯一选平台的地方，src 里不写平台比较（eslint.config.mjs）。
 * 读取 process.platform 和 process.arch 只在本文件发生，其它模块用 currentPlatform() 取得当前平台，再传给下面的函数。
 * 函数接收平台参数，测试可以在任意主机上覆盖三个平台（tests/platform.test.cjs）。
 *
 * currentPlatform() 每次调用时读取，不缓存：已有测试通过改写 process.platform 模拟其它平台。
 */

export function currentPlatform(): NodeJS.Platform {
    return process.platform;
}

export function currentArch(): string {
    return process.arch;
}

const IMPLS: Record<'win32' | 'darwin' | 'linux', PlatformImpl> = { win32, darwin, linux };

function supportedImpl(platform: NodeJS.Platform): PlatformImpl | undefined {
    return Object.hasOwn(IMPLS, platform) ? IMPLS[platform as keyof typeof IMPLS] : undefined;
}

/** 没有自己实现的平台（freebsd 之类）按 Linux 运行。只有安装包名不这样回退：这些平台没有安装包。 */
function implFor(platform: NodeJS.Platform): PlatformImpl {
    return supportedImpl(platform) ?? linux;
}

export function platformBehavior(platform: NodeJS.Platform = currentPlatform()): PlatformBehavior {
    return implFor(platform).behavior;
}

/**
 * 用户 MPV 配置目录，按 mpv 的查找规则（#77，docs/external-runtime.md；mpv 源码 options/path.c）：
 * MPV_HOME 优先，各平台都读，也优先于 Windows 的 portable_config（mp_init_paths）；否则按平台查找。
 * 空的 MPV_HOME 在 mpv 里等于不读用户配置，这里按未设处理，同步仍有地方可写。
 * pathExists 由调用方传入（通常是 fs.existsSync），本函数不碰文件系统，测试可以用临时目录或假函数。
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
    return implFor(platform).mpvUserConfigDir(dirs, env, userMpvPath, pathExists);
}

/**
 * 客户端这次会运行的 MPV：自选 MPV 优先，不检查它是否存在；否则 Windows 用附带 MPV（同样不检查），
 * macOS 和 Linux 取已知位置里第一个存在的。找不到时返回 undefined，由调用方决定是否提示。
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
    return implFor(platform).defaultMpvPlayer(bundledMpvPath, pathExists);
}

/**
 * 一次播放用的 MPV IPC 地址，id 由调用方保证唯一（进程号加随机串）。node-mpv-2 默认用固定的
 * \\.\pipe\mpvserver 或 /tmp/node-mpv.sock，start() 先连这个地址，连上 MPV 就直接接管，
 * 用户自己开着带同名 IPC 的 MPV 或客户端开了两份时会连错。
 * Windows 是命名管道，不落盘；其它平台是 tmpDir 下的 socket 文件。
 */
export function mpvIpcSocket(platform: NodeJS.Platform, tmpDir: string, id: string): MpvIpcSocket {
    return implFor(platform).mpvIpcSocket(tmpDir, `fntv-mpv-${id}`);
}

/**
 * 应用内更新用于打包后的 Windows（NSIS）和 Linux（AppImage）客户端，macOS 不做。
 * isWritableDir 由调用方传入（通常用 fs.accessSync 的 W_OK），本函数不碰文件系统。
 */
export function inAppUpdateAvailability(
    platform: NodeJS.Platform,
    isPackaged: boolean,
    appImagePath: string | undefined,
    isWritableDir: (dir: string) => boolean,
): InAppUpdateAvailability {
    return implFor(platform).inAppUpdateAvailability(isPackaged, appImagePath, isWritableDir);
}

/** 按 package.json 的 artifactName（FNMedia_${version}_${os}_${arch}.${ext}）拼出安装包名，没有这个架构的包时是 null。 */
export function installerAssetName(platform: NodeJS.Platform, arch: string, version: string): string | null {
    const suffixes = supportedImpl(platform)?.installerAssetSuffix ?? {};
    return Object.hasOwn(suffixes, arch) ? `FNMedia_${version}_${suffixes[arch]}` : null;
}
