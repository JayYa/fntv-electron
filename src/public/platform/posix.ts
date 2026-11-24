import * as path from 'node:path';
import { MpvIpcSocket, MpvProgram, UserDirs } from './shared';

export function posixMpvUserConfigDir(dirs: UserDirs, env: Record<string, string | undefined>, pathExists: (target: string) => boolean): string {
    const xdgConfigHome = env.XDG_CONFIG_HOME;
    const configHome = xdgConfigHome?.startsWith('/') ? xdgConfigHome : path.posix.join(dirs.homeDir, '.config');
    const standardDir = path.posix.join(configHome, 'mpv');
    const legacyDir = path.posix.join(dirs.homeDir, '.mpv');
    if (!pathExists(standardDir) && pathExists(legacyDir)) {
        return legacyDir;
    }
    return standardDir;
}

export function firstExistingMpv(searchPaths: string[], pathExists: (target: string) => boolean): MpvProgram | undefined {
    const found = searchPaths.find(pathExists);
    return found ? { path: found, bundled: false } : undefined;
}

const UNIX_SOCKET_PATH_MAX_BYTES = 103;

export function posixMpvIpcSocket(tmpDir: string, name: string): MpvIpcSocket {
    const socketPath = path.posix.join(tmpDir, `${name}.sock`);
    if (Buffer.byteLength(socketPath) <= UNIX_SOCKET_PATH_MAX_BYTES) {
        return { path: socketPath, isFile: true };
    }
    return { path: path.posix.join('/tmp', `${name}.sock`), isFile: true };
}
