import { CreatePlaybackSessionRequest, PROXY_HOST, ProxyMessage } from '../../modules/proxy_service/control';
import type { PlaybackSessionInput } from '../../modules/proxy_service/playbackSessions';

export type { PlaybackSessionInput } from '../../modules/proxy_service/playbackSessions';

const SESSION_PATTERN = /^[a-f0-9]{64}$/;

interface Pending {
    resolve(session: string): void;
    reject(error: Error): void;
    timer: NodeJS.Timeout;
}

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

export interface ProxyPlaybackSession {
    session: string;
    port: number;
}

export function createProxyPlaybackUrl(playback: ProxyPlaybackSession, itemGuid: string, sourceIndex: number = 0): string {
    const query = new URLSearchParams({ session: playback.session });
    if (sourceIndex > 0) query.set('sourceIndex', String(sourceIndex));
    return `http://${PROXY_HOST}:${playback.port}/api/v1/playvideo/${encodeURIComponent(itemGuid)}?${query}`;
}
