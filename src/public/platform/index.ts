import { darwin } from './darwin';
import { linux } from './linux';
import { InAppUpdateAvailability, MpvIpcSocket, MpvPlayer, PlatformBehavior, PlatformImpl, UserDirs } from './shared';
import { win32 } from './win32';

export type { CloseBehaviorSetting, InAppUpdateAvailability, MpvIpcSocket, MpvPlayer, PlatformBehavior, UserDirs } from './shared';

export function currentPlatform(): NodeJS.Platform {
    return process.platform;
}

export function currentArch(): string {
    return process.arch;
}

const IMPLS: Record<'win32' | 'darwin' | 'linux', PlatformImpl> = { win32, darwin, linux };

function implWithInstaller(platform: NodeJS.Platform): PlatformImpl | undefined {
    return Object.hasOwn(IMPLS, platform) ? IMPLS[platform as keyof typeof IMPLS] : undefined;
}

function implOrLinux(platform: NodeJS.Platform): PlatformImpl {
    return implWithInstaller(platform) ?? linux;
}

export function platformBehavior(platform: NodeJS.Platform = currentPlatform()): PlatformBehavior {
    return implOrLinux(platform).behavior;
}

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
    return implOrLinux(platform).mpvUserConfigDir(dirs, env, userMpvPath, pathExists);
}

export function mpvPlayer(
    platform: NodeJS.Platform,
    userMpvPath: string | undefined,
    bundledMpvPath: string,
    pathExists: (target: string) => boolean,
): MpvPlayer | undefined {
    if (userMpvPath) {
        return { path: userMpvPath, bundled: false };
    }
    return implOrLinux(platform).defaultMpvPlayer(bundledMpvPath, pathExists);
}

export function mpvIpcSocket(platform: NodeJS.Platform, tmpDir: string, id: string): MpvIpcSocket {
    return implOrLinux(platform).mpvIpcSocket(tmpDir, `fntv-mpv-${id}`);
}

export function inAppUpdateAvailability(
    platform: NodeJS.Platform,
    isPackaged: boolean,
    appImagePath: string | undefined,
    isWritableDir: (dir: string) => boolean,
): InAppUpdateAvailability {
    const impl = implWithInstaller(platform);
    if (!impl) {
        return { available: false, reason: `${platform} 不支持应用内更新` };
    }
    return impl.inAppUpdateAvailability(isPackaged, appImagePath, isWritableDir);
}

export function installerAssetName(platform: NodeJS.Platform, arch: string, version: string): string | null {
    const suffixes = implWithInstaller(platform)?.installerAssetSuffix ?? {};
    return Object.hasOwn(suffixes, arch) ? `FNMedia_${version}_${suffixes[arch]}` : null;
}
