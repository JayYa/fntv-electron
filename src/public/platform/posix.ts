import * as path from 'node:path';
import { MpvIpcSocket, MpvPlayer, UserDirs } from './shared';

/** macOS 和 Linux 共用的部分。路径都用 path.posix 拼，结果与运行测试的主机无关。 */

/**
 * mpv 的查找规则（osdep/path-unix.c、osdep/path-darwin.c、options/configfiles.c）：
 * $XDG_CONFIG_HOME/mpv（mpv 只认绝对路径），否则 ~/.config/mpv。
 * 标准目录不存在而 ~/.mpv 存在时，mpv 只读 ~/.mpv；两者都在时以标准目录为准（#115）。
 */
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

/** 依次检查 searchPaths，取第一个存在的。macOS 和 Linux 没有附带 MPV。 */
export function firstExistingMpv(searchPaths: string[], pathExists: (target: string) => boolean): MpvPlayer | undefined {
    const found = searchPaths.find(pathExists);
    return found ? { path: found, bundled: false } : undefined;
}

/** Unix socket 路径的字节上限：macOS 的 sun_path 是 104 字节（含结尾的 0），Linux 是 108。 */
const UNIX_SOCKET_PATH_MAX_BYTES = 103;

/** 放在 tmpDir 下，超过 sun_path 上限时 MPV 绑定不了，改放 /tmp。 */
export function posixMpvIpcSocket(tmpDir: string, name: string): MpvIpcSocket {
    const socketPath = path.posix.join(tmpDir, `${name}.sock`);
    if (Buffer.byteLength(socketPath) <= UNIX_SOCKET_PATH_MAX_BYTES) {
        return { path: socketPath, isFile: true };
    }
    return { path: path.posix.join('/tmp', `${name}.sock`), isFile: true };
}
