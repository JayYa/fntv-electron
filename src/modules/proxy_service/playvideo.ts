import * as crypto from 'node:crypto';
import type * as http from 'node:http';
import { composeCookieHeader } from '../fn_api/core/cookie';
import type { TtlCache } from '../fn_api/core/ttlCache';
import { CLOUD_TYPE_115, forward115, RateLimiter } from './cloud115';
import { cloudDirectTarget, directLinkOf } from './directLink';
import { forward } from './forward';
import type { PlaybackSessionStore } from './playbackSessions';
import { CLOUD_TYPE_QUARK, FileMeta, forwardQuark } from './quark';
import { sendJson } from './respond';
import { SessionApiDeps, sessionApiClient } from './sessionApiClient';

export type PlayVideoDeps = SessionApiDeps & {
    sessions: PlaybackSessionStore;
    limiter115: RateLimiter;
    quarkMetaCache: TtlCache<FileMeta>;
    quarkIdleTimeoutMs: number;
};

const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;

function parseSourceIndex(value: string | null): number | undefined {
    if (value === null || value === '') return 0;
    if (!/^[+-]?\d+$/.test(value)) return undefined;
    const parsed = Number(value);
    return parsed >= INT32_MIN && parsed <= INT32_MAX ? parsed : undefined;
}

function stringToUuid(value: string): string {
    if (!value) return '00000000-0000-0000-0000-000000000000';
    const hex = crypto.createHash('sha1').update(value, 'utf8').digest('hex').slice(0, 32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function handlePlayVideo(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    itemGuid: string,
    query: URLSearchParams,
    deps: PlayVideoDeps,
): Promise<void> {
    const sessionId = query.get('session') ?? '';
    const sourceIndex = parseSourceIndex(query.get('sourceIndex'));
    if (!sessionId || sourceIndex === undefined) {
        deps.log.error('解析参数失败: playvideo');
        sendJson(res, 400, { error: 'Invalid parameters' });
        return;
    }

    const session = deps.sessions.resolve(sessionId, itemGuid);
    if (!session) {
        deps.log.warn(`拒绝无效播放会话: itemGuid=${itemGuid}`);
        sendJson(res, 401, { error: 'Invalid playback session' });
        return;
    }

    const api = sessionApiClient(session, deps);
    const list = await api.getStreamListCached(itemGuid);
    const videoStreams = list.success ? list.data?.video_streams ?? [] : [];
    if (videoStreams.length === 0) {
        deps.log.error('获取播放信息失败或为空');
        sendJson(res, 500, { error: 'Failed to get play info' });
        return;
    }

    const mediaGuid = sourceIndex > 0 && sourceIndex < videoStreams.length
        ? videoStreams[sourceIndex].media_guid
        : videoStreams[0].media_guid;

    const stream = await api.getStreamCached(mediaGuid, stringToUuid(session.account));
    if (!stream.success) {
        deps.log.error('获取视频流失败');
        sendJson(res, 500, { error: 'Failed to get stream' });
        return;
    }

    const directLink = stream.data ? directLinkOf(stream.data) : undefined;
    if (directLink && !session.useNasLocal) {
        deps.log.info(`启用云存储直连: type=${directLink.cloudType}`);
        if (directLink.cloudType === CLOUD_TYPE_QUARK) {
            deps.log.info(`开始转发 | 模式: 夸克分片 | itemGuid: ${itemGuid}`);
            await forwardQuark(req, res, cloudDirectTarget(directLink, deps.ca), directLink.url, {
                metaCache: deps.quarkMetaCache,
                idleTimeoutMs: deps.quarkIdleTimeoutMs,
                log: deps.log,
            });
            return;
        }
        deps.log.info(`开始转发 | 模式: 透明转发 | itemGuid: ${itemGuid}`);
        if (directLink.cloudType === CLOUD_TYPE_115) await forward115(req, res, cloudDirectTarget(directLink, deps.ca), deps.limiter115, deps.log);
        else await forward(req, res, cloudDirectTarget(directLink, deps.ca), deps.log);
        return;
    }

    deps.log.info(`开始转发 | 模式: NAS | itemGuid: ${itemGuid}`);
    await forward(req, res, {
        url: api.getVideoUrl(mediaGuid),
        headers: {
            authorization: session.token,
            cookie: composeCookieHeader(session.accessCookie),
        },
        skipVerify: session.skipVerify,
        ca: deps.ca,
    }, deps.log);
}
