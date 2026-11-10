// 主进程这一侧的播放会话：经 IPC 让 Proxy 创建，再拼出交给 MPV 的播放地址。
import { CreatePlaybackSessionRequest, PROXY_HOST, ProxyMessage } from '../../modules/proxy_service/control';
import type { PlaybackSessionInput } from '../../modules/proxy_service/playbackSessions';

export type { PlaybackSessionInput } from '../../modules/proxy_service/playbackSessions';

const SESSION_PATTERN = /^[a-f0-9]{64}$/;

interface Pending {
    resolve(session: string): void;
    reject(error: Error): void;
    timer: NodeJS.Timeout;
}

// 一个 Proxy 子进程对应一个客户端。send 把消息发给子进程，子进程的回复交给 receive。
export class ProxyControlClient {
    private nextId = 1;
    private readonly pending = new Map<number, Pending>();
    private closedWith: Error | null = null;

    constructor(private readonly send: (message: CreatePlaybackSessionRequest) => void) {}

    createPlaybackSession(input: PlaybackSessionInput, timeoutMs: number = 5000): Promise<string> {
        if (this.closedWith) return Promise.reject(this.closedWith);
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('Proxy 创建播放会话超时'));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            try {
                this.send({ type: 'createPlaybackSession', id, input });
            } catch (error) {
                this.settle(id, (entry) => entry.reject(new Error('Proxy 创建播放会话失败', { cause: error })));
            }
        });
    }

    // 处理子进程的回复，不是播放会话回复的消息不处理。
    receive(message: ProxyMessage): void {
        if (message.type === 'playbackSession') {
            this.settle(message.id, (entry) => {
                if (SESSION_PATTERN.test(message.session)) entry.resolve(message.session);
                else entry.reject(new Error('Proxy 返回了无效的播放会话'));
            });
        } else if (message.type === 'playbackSessionFailed') {
            this.settle(message.id, (entry) => entry.reject(new Error(`Proxy 创建播放会话失败: ${message.message}`)));
        }
    }

    // 子进程退出时调用：还在等的请求和之后的请求都以 error 失败。
    close(error: Error): void {
        this.closedWith = error;
        for (const id of [...this.pending.keys()]) {
            this.settle(id, (entry) => entry.reject(error));
        }
    }

    private settle(id: number, action: (entry: Pending) => void): void {
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        clearTimeout(entry.timer);
        action(entry);
    }
}

// 播放会话只在创建它的那个 Proxy 子进程里有效，所以会话 ID 和该进程的端口一起返回。
export interface ProxyPlaybackSession {
    session: string;
    port: number;
}

export function createProxyPlaybackUrl(playback: ProxyPlaybackSession, itemGuid: string, sourceIndex: number = 0): string {
    const query = new URLSearchParams({ session: playback.session });
    if (sourceIndex > 0) query.set('sourceIndex', String(sourceIndex));
    return `http://${PROXY_HOST}:${playback.port}/api/v1/playvideo/${encodeURIComponent(itemGuid)}?${query}`;
}
