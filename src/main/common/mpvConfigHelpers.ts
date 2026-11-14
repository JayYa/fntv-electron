import * as path from 'path';

// 同步本身在 ./mpvConfigSync/sync.ts（按 MPV 归档清单同步）。

interface PortableConfigPaths {
    appPath: string;
    isPackaged: boolean;
    resourcesPath: string;
}

interface BundledMpvPaths {
    appPath: string;
    execPath: string;
    isPackaged: boolean;
}

export function resolvePortableConfigDir(paths: PortableConfigPaths): string {
    const baseDir = paths.isPackaged
        ? path.dirname(paths.resourcesPath)
        : paths.appPath;
    return path.join(baseDir, 'third_party', 'fntv-mpv', 'portable_config');
}

export function resolveBundledMpvPath(paths: BundledMpvPaths): string {
    const baseDir = paths.isPackaged
        ? path.dirname(paths.execPath)
        : paths.appPath;
    return path.join(baseDir, 'third_party', 'fntv-mpv', 'mpv.exe');
}
