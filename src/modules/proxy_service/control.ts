// 主进程和 Proxy 子进程之间的 IPC 消息（ADR-0004）。HTTP 只给 MPV 取流，控制都走这里。
import type { ProxyLogMessage } from './log';
import type { PlaybackSessionInput } from './playbackSessions';

export const PROXY_HOST = '127.0.0.1';
// 正式运行时的端口。固定不变：MPV 归档里 smart_skip 的 api.lua 写死了 http://127.0.0.1:22345（docs/external-runtime.md）。
export const PROXY_PORT = 22345;

// 主进程 → Proxy：创建播放会话。id 由主进程分配，回复原样带回。
export interface CreatePlaybackSessionRequest {
    type: 'createPlaybackSession';
    id: number;
    input: PlaybackSessionInput;
}

export type CreatePlaybackSessionReply =
    | { type: 'playbackSession'; id: number; session: string }
    | { type: 'playbackSessionFailed'; id: number; message: string };

// Proxy → 主进程：启动结果和日志。code 是监听失败时的错误码，端口被占用时为 EADDRINUSE。
export type ProxyStatusMessage =
    | { type: 'ready'; port: number }
    | { type: 'startFailed'; code: string; message: string }
    | ProxyLogMessage;

export type ProxyMessage = CreatePlaybackSessionReply | ProxyStatusMessage;

export function handleControlRequest(
    service: { createPlaybackSession(input: PlaybackSessionInput): string },
    request: CreatePlaybackSessionRequest,
): CreatePlaybackSessionReply {
    try {
        return { type: 'playbackSession', id: request.id, session: service.createPlaybackSession(request.input) };
    } catch (error) {
        return { type: 'playbackSessionFailed', id: request.id, message: error instanceof Error ? error.message : String(error) };
    }
}
