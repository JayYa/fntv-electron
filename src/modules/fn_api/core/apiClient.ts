import { FnApiRequest, FnApiResult, HttpMethod, RequestContext, request } from './request';
import { TtlCache } from './ttlCache';
import { createApiCacheKey } from './cacheKey';
import * as types from './types';

const inFlightByCache = new WeakMap<TtlCache, Map<string, Promise<FnApiResult>>>();

function inFlightFor(cache: TtlCache): Map<string, Promise<FnApiResult>> {
    let inFlight = inFlightByCache.get(cache);
    if (!inFlight) {
        inFlight = new Map();
        inFlightByCache.set(cache, inFlight);
    }
    return inFlight;
}

const TOKEN_CHECK_TIMEOUT = 5000;
const USER_INFO_PATH = '/v/api/v1/user/info';

export class FnApiClient {
    protected readonly baseURL: string;
    protected readonly token: string;
    protected readonly context: RequestContext;
    private readonly cache: TtlCache;
    private readonly inFlight: Map<string, Promise<FnApiResult>>;

    constructor(context: RequestContext, baseURL: string, token: string, cache: TtlCache) {
        this.context = context;
        this.baseURL = baseURL.replace(/\/+$/, '');
        this.token = token;
        this.cache = cache;
        this.inFlight = inFlightFor(cache);
    }

    getBaseURL(): string {
        return this.baseURL;
    }

    private send<T>(method: HttpMethod, path: string, options: Omit<FnApiRequest, 'baseUrl' | 'path' | 'method' | 'token'> = {}): Promise<FnApiResult<T>> {
        return request<T>(this.context, { baseUrl: this.baseURL, path, method, token: this.token, ...options });
    }

    private cached<A extends unknown[], T>(
        fn: (...args: A) => Promise<FnApiResult<T>>,
        name: string,
        ttl: number,
    ): (...args: A) => Promise<FnApiResult<T>> {
        return (...args: A) => {
            const key = createApiCacheKey(this.baseURL, this.token, name, args);
            const cached = this.cache.get(key) as FnApiResult<T> | undefined;
            if (cached !== undefined) {
                this.context.log.debug?.(`缓存命中: ${name}`);
                return Promise.resolve(cached);
            }

            const existingPromise = this.inFlight.get(key) as Promise<FnApiResult<T>> | undefined;
            if (existingPromise) {
                this.context.log.debug?.(`复用进行中的请求: ${name}`);
                return existingPromise;
            }

            const promise = fn(...args).then(result => {
                if (!result.ok) return result;
                this.cache.set(key, result, ttl);
                this.context.log.debug?.(`缓存设置: ${name}, TTL: ${ttl}s`);
                return result;
            }).finally(() => {
                this.inFlight.delete(key);
            });

            this.inFlight.set(key, promise);
            return promise;
        };
    }

    login(username: string, password: string): Promise<FnApiResult<types.LoginResponse>> {
        const data: types.LoginData = { app_name: "trimemedia-web", username, password };
        return this.send(HttpMethod.POST, '/v/api/v1/login', { data });
    }

    getSysConfig(cookie?: string): Promise<FnApiResult<types.SysConfigResponse>> {
        return this.send(HttpMethod.GET, '/v/api/v1/sys/config', { cookie });
    }

    auth(code: string): Promise<FnApiResult<types.AuthResponse>> {
        const data: types.AuthRequest = { source: "Trim-NAS", code };
        return this.send(HttpMethod.POST, '/v/api/v1/auth', { data });
    }

    logout(): Promise<FnApiResult<unknown>> {
        return this.send(HttpMethod.POST, '/v/api/v1/logout');
    }

    getUserInfo(): Promise<FnApiResult<types.UserInfo>> {
        return this.send(HttpMethod.GET, USER_INFO_PATH);
    }

    async tokenAccepted(): Promise<boolean> {
        const result = await this.send(HttpMethod.GET, USER_INFO_PATH, { timeout: TOKEN_CHECK_TIMEOUT, retries: 0 });
        return result.ok;
    }

    getEpisodeList(id: string): Promise<FnApiResult<types.PlayListItem[]>> {
        return this.send(HttpMethod.GET, `/v/api/v1/episode/list/${id}`);
    }

    getItemList(req: types.ItemListRequest): Promise<FnApiResult<types.ItemListResponse>> {
        return this.send(HttpMethod.POST, '/v/api/v1/item/list', { data: req });
    }

    setWatched(itemGuid: string): Promise<FnApiResult<unknown>> {
        const data: types.WatchedData = { item_guid: itemGuid };
        return this.send(HttpMethod.POST, '/v/api/v1/item/watched', { data });
    }

    savePlayRecord(record: types.PlayRecord): Promise<FnApiResult<unknown>> {
        return this.send(HttpMethod.POST, '/v/api/v1/play/record', { data: record });
    }

    getSubtitleFile(subtitleGuid: string): Promise<FnApiResult<string>> {
        return this.send(HttpMethod.GET, `/v/api/v1/subtitle/dl/${subtitleGuid}`, { expect: 'raw' });
    }

    getPlayInfo(itemGuid: string): Promise<FnApiResult<types.PlayInfo>> {
        const data: types.PlayInfoData = { item_guid: itemGuid };
        return this.send(HttpMethod.POST, '/v/api/v1/play/info', { data });
    }

    setSkipInfo(parentGuid: string, skipStart: number, skipEnd: number): Promise<FnApiResult<unknown>> {
        const data: types.SetSkipInfoData = {
            guid: parentGuid,
            skip_opening: skipStart,
            skip_ending: skipEnd,
        };
        return this.send(HttpMethod.POST, '/v/api/v1/play/setConfigByItem', { data });
    }

    getPlayQuality(mediaGuid: string): Promise<FnApiResult<types.PlayQualityResponse>> {
        return this.send(HttpMethod.POST, '/v/api/v1/play/quality', { data: { media_guid: mediaGuid } });
    }

    getStreamList(itemGuid: string): Promise<FnApiResult<types.StreamListResponse>> {
        return this.send(HttpMethod.GET, `/v/api/v1/stream/list/${itemGuid}`);
    }

    getStream(mediaGuid: string, ip: string): Promise<FnApiResult<types.StreamResponse>> {
        const data: types.StreamRequestData = {
            header: {
                "User-Agent": ["trim_player"]
            },
            level: 1,
            media_guid: mediaGuid,
            ip: ip,
        };
        return this.send(HttpMethod.POST, '/v/api/v1/stream', { data });
    }

    getVideoUrl(mediaGuid: string): string {
        return `${this.baseURL}/v/api/v1/media/range/${mediaGuid}`;
    }

    getPlayInfoCached = this.cached(this.getPlayInfo.bind(this), 'getPlayInfo', 300);

    getPlayQualityCached = this.cached(this.getPlayQuality.bind(this), 'getPlayQuality', 300);

    getStreamListCached = this.cached(this.getStreamList.bind(this), 'getStreamList', 300);

    getStreamCached = this.cached(this.getStream.bind(this), 'getStream', 300);
}
