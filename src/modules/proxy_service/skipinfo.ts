// smart_skip 读写片头片尾信息：GET /api/v1/skipinfo/:itemGuid?session=…、POST /api/v1/skipinfo?session=…。
// 响应格式与 Go 版一致：成功 {code:0,msg:"success"}，失败 {code:1000,msg}。
import type * as http from 'node:http';
import type { TtlCache } from '../fn_api/core/ttlCache';
import type { ProxyLog } from './log';
import type { PlaybackSessionStore } from './playbackSessions';
import { readBody, sendJson } from './respond';
import { sessionApiClient } from './sessionApiClient';

export interface SkipInfoDeps {
    sessions: PlaybackSessionStore;
    cache: TtlCache;
    ca: string[];
    log: ProxyLog;
}

const INTERNAL_ERROR_CODE = 1000;

function sendError(res: http.ServerResponse, status: number, msg: string): void {
    sendJson(res, status, { code: INTERNAL_ERROR_CODE, msg });
}

export async function handleGetSkipInfo(
    res: http.ServerResponse,
    itemGuid: string,
    query: URLSearchParams,
    deps: SkipInfoDeps,
): Promise<void> {
    // 只读 query 里的 session，query 不覆盖路径里的 itemGuid（U-13，不照搬 gin）。
    const sessionId = query.get('session') ?? '';
    if (!sessionId) {
        deps.log.error(`缺少必要参数: sessionPresent=false, itemGuid=${itemGuid}`);
        sendError(res, 400, 'Missing required parameters');
        return;
    }
    const session = deps.sessions.resolve(sessionId, itemGuid);
    if (!session) {
        sendError(res, 401, 'Invalid playback session');
        return;
    }

    deps.log.info(`开始获取跳过片头片尾信息: itemGuid=${itemGuid}`);
    // 不走缓存，每次都取 NAS 上的最新值。
    const info = await sessionApiClient(session, deps).getPlayInfo(itemGuid);
    if (!info.success) {
        deps.log.error('获取跳过片头片尾信息失败');
        sendError(res, 500, 'Failed to get skip info');
        return;
    }
    const playConfig = info.data?.play_config;
    sendJson(res, 200, {
        code: 0,
        msg: 'success',
        data: { skipStart: playConfig?.skip_opening ?? 0, skipEnd: playConfig?.skip_ending ?? 0 },
    });
}

interface SkipInfoBody {
    guid: string;
    skipStart: number;
    skipEnd: number;
}

// 按 Go 的 encoding/json 解到 {guid, skipStart, skipEnd}：键名不分大小写，null 当作没写，多余字段忽略；
// 类型不对、时间点不是整数时返回 undefined。body 里的 session 也当作多余字段（U-13，不照搬 gin）。
function parseSkipInfoBody(text: string): SkipInfoBody | undefined {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return undefined;
    }
    if (value === null) value = {};
    if (typeof value !== 'object' || Array.isArray(value)) return undefined;

    const body: SkipInfoBody = { guid: '', skipStart: 0, skipEnd: 0 };
    for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
        if (field === null) continue;
        switch (key.toLowerCase()) {
            case 'guid':
                if (typeof field !== 'string') return undefined;
                body.guid = field;
                break;
            case 'skipstart':
            case 'skipend':
                if (!Number.isSafeInteger(field)) return undefined;
                body[key.toLowerCase() === 'skipstart' ? 'skipStart' : 'skipEnd'] = field as number;
                break;
        }
    }
    return body;
}

export async function handleSetSkipInfo(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    query: URLSearchParams,
    deps: SkipInfoDeps,
): Promise<void> {
    // 先解析 body，再看 query，与 Go 版的顺序一致。query 只读 session，不覆盖 body 里的值（U-13）。
    const body = parseSkipInfoBody((await readBody(req)).toString('utf8'));
    if (!body) {
        deps.log.error('解析请求体失败: skipinfo');
        sendError(res, 400, 'Invalid request body');
        return;
    }
    const sessionId = query.get('session') ?? '';
    if (!sessionId || !body.guid) {
        deps.log.error(`缺少必要参数: sessionPresent=${sessionId !== ''}, guid=${body.guid}`);
        sendError(res, 400, 'Missing required parameters');
        return;
    }
    const session = deps.sessions.resolve(sessionId, body.guid);
    if (!session) {
        sendError(res, 401, 'Invalid playback session');
        return;
    }

    const api = sessionApiClient(session, deps);
    const info = await api.getPlayInfoCached(body.guid);
    if (!info.success) {
        deps.log.error('获取播放信息缓存失败');
        sendError(res, 500, 'Failed to get play info cache');
        return;
    }
    const parentGuid = info.data?.parent_guid ?? '';

    // 时间点不做范围检查，负数也原样写给 NAS（G-161-07）。
    deps.log.info(`开始设置跳过片头片尾信息: parentGuid=${parentGuid}, skipStart=${body.skipStart}, skipEnd=${body.skipEnd}`);
    const written = await api.setSkipInfo(parentGuid, body.skipStart, body.skipEnd);
    if (!written.success) {
        deps.log.error('设置跳过片头片尾信息失败');
        sendError(res, 500, 'Failed to set skip info');
        return;
    }
    sendJson(res, 200, { code: 0, msg: 'success' });
}
