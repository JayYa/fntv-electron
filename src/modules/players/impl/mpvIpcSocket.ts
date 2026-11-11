import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import { currentPlatform, mpvIpcSocket, MpvIpcSocket } from '../../../public/platform';

/**
 * 一次播放用的 MPV IPC 地址，进程号加随机串，同一进程的多次播放和同时运行的多份客户端都不重复。
 * 不能用 node-mpv-2 的固定默认值：start() 先连那个地址，连上已有的 MPV 就直接接管。
 */
export function createPlaybackIpcSocket(): MpvIpcSocket {
    return mpvIpcSocket(currentPlatform(), os.tmpdir(), `${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
}

/**
 * 删除 Unix socket 文件，Windows 的命名管道不落盘，什么也不做。只在 MPV 退出后或 quit() 返回后调用：
 * 库处理 seek 等事件时会按路径另开连接，MPV 还在运行时删掉文件，那次连接失败会成为未捕获异常。
 */
export function removePlaybackIpcSocket(socket: MpvIpcSocket | null, onError: (error: Error) => void): void {
    if (!socket?.isFile) {
        return;
    }
    fs.rm(socket.path, { force: true }, (error) => {
        if (error) {
            onError(error);
        }
    });
}
