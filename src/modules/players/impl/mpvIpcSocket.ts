import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import { currentPlatform, mpvIpcSocket, MpvIpcSocket } from '../../../public/platform';

export function createPlaybackIpcSocket(): MpvIpcSocket {
    return mpvIpcSocket(currentPlatform(), os.tmpdir(), `${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
}

export function removePlaybackIpcSocket(socket: MpvIpcSocket | null, onError: (error: Error) => void): Promise<void> {
    if (!socket?.isFile) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        fs.rm(socket.path, { force: true }, (error) => {
            if (error) {
                onError(error);
            }
            resolve();
        });
    });
}
