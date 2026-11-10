// 用播放会话里的 NAS 地址、token 和访问授权 Cookie 访问飞牛 API。
import { FnApiClient } from '../fn_api/core/apiClient';
import type { RequestContext } from '../fn_api/core/request';
import type { TtlCache } from '../fn_api/core/ttlCache';
import type { ProxyLog } from './log';
import type { PlaybackSession } from './playbackSessions';

export interface SessionApiDeps {
    cache: TtlCache;
    ca: string[];
    log: ProxyLog;
}

export function sessionApiClient(session: PlaybackSession, deps: SessionApiDeps): FnApiClient {
    const context: RequestContext = {
        accessCookie: () => session.accessCookie,
        skipVerify: () => session.skipVerify,
        log: deps.log,
        ca: deps.ca,
    };
    return new FnApiClient(context, session.domain, session.token, deps.cache);
}
