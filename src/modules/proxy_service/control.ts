import type { ProxyLogMessage } from './log';
import type { PlaybackSessionInput } from './playbackSessions';

export const PROXY_HOST = '127.0.0.1';

export interface CreatePlaybackSessionRequest {
    type: 'createPlaybackSession';
    id: number;
    input: PlaybackSessionInput;
}

export type CreatePlaybackSessionReply =
    | { type: 'playbackSession'; id: number; session: string }
    | { type: 'playbackSessionFailed'; id: number; message: string };

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
