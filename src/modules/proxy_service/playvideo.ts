// GET /api/v1/playvideo/:itemGuid?session=…&sourceIndex=…：按播放源选流，转发视频流。
import * as crypto from 'node:crypto';
import type * as http from 'node:http';
import { FnApiClient } from '../fn_api/core/apiClient';
import { composeCookieHeader } from '../fn_api/core/cookie';
import type { RequestContext } from '../fn_api/core/request';
import type { TtlCache } from '../fn_api/core/ttlCache';
import { cloudDirectTarget, directLinkOf } from './directLink';
import { forward } from './forward';
import type { ProxyLog } from './log';
import type { PlaybackSession, PlaybackSessionStore } from './playbackSessions';
import { sendJson } from './respond';

export interface PlayVideoDeps {
    sessions: PlaybackSessionStore;
    cache: TtlCache;
    ca: string[];
    log: ProxyLog;
}

const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;

// 与 Go 的 strconv.ParseInt(s, 10, 32) 一致；缺省或空串按 0。
function parseSourceIndex(value: string | null): number | undefined {
    if (value === null || value === '') return 0;
    if (!/^[+-]?\d+$/.test(value)) return undefined;
    const parsed = Number(value);
    return parsed >= INT32_MIN && parsed <= INT32_MAX ? parsed : undefined;
}

// 流信息请求里的 ip：sha1(account) 的前 16 字节按 UUID 格式写出，与 Go 的 StringToUUID 一致。
function stringToUuid(value: string): string {
    if (!value) return '00000000-0000-0000-0000-000000000000';
    const hex = crypto.createHash('sha1').update(value, 'utf8').digest('hex').slice(0, 32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function apiClient(session: PlaybackSession, deps: PlayVideoDeps): FnApiClient {
    const context: RequestContext = {
        accessCookie: () => session.accessCookie,
        skipVerify: () => session.skipVerify,
        log: deps.log,
        ca: deps.ca,
    };
    return new FnApiClient(context, session.domain, session.token, deps.cache);
}

export async function handlePlayVideo(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    itemGuid: string,
    query: URLSearchParams,
    deps: PlayVideoDeps,
): Promise<void> {
    // 只读 query 里的 session 和 sourceIndex，query 不覆盖路径参数（U-13，不照搬 gin）。
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

    const api = apiClient(session, deps);
    const list = await api.getStreamListCached(itemGuid);
    const videoStreams = list.success ? list.data?.video_streams ?? [] : [];
    if (videoStreams.length === 0) {
        deps.log.error('获取播放信息失败或为空');
        sendJson(res, 500, { error: 'Failed to get play info' });
        return;
    }

    // 越界或为负时退回第 0 个，与 Go 版一致。
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
        // 115 和夸克的特殊处理按 directLink.cloudType 在这里分支，其余网盘透明转发。
        deps.log.info(`开始代理 | 模式: 透明转发 | itemGuid: ${itemGuid}`);
        await forward(req, res, cloudDirectTarget(directLink, deps.ca), deps.log);
        return;
    }

    // NAS 本地播放源，以及 NAS 中转的直链媒体。
    deps.log.info(`开始代理 | 模式: NAS | itemGuid: ${itemGuid}`);
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
