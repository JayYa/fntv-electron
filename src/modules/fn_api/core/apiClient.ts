import { ApiResponse, HttpMethod, RequestContext, request } from './request';
import { TtlCache } from './ttlCache';
import { createApiCacheKey } from './cacheKey';
import * as types from './types';

type CacheOptions = { ttl?: number, forceRefresh?: boolean };

export class FnApiClient {
    protected readonly baseURL: string;
    protected readonly token: string;
    protected readonly context: RequestContext;
    private readonly cache: TtlCache;

    constructor(context: RequestContext, baseURL: string, token: string, cache: TtlCache) {
        this.context = context;
        this.baseURL = baseURL.replace(/\/+$/, '');
        this.token = token;
        this.cache = cache;
    }

    getBaseURL(): string {
        return this.baseURL;
    }

    protected createCachedFunction<T extends (...args: any[]) => Promise<ApiResponse>>(
        fn: T,
        name: string,
        defaultTtl: number = 300
    ): (...args: [...Parameters<T>, options?: CacheOptions]) => ReturnType<T> {
        return ((...allArgs: any[]) => {
            const lastArg = allArgs[allArgs.length - 1];
            let options = { ttl: defaultTtl, forceRefresh: false };
            let args: Parameters<T>;
            if (lastArg && typeof lastArg === 'object' && (lastArg.ttl !== undefined || lastArg.forceRefresh !== undefined)) {
                options = { ...options, ...lastArg };
                args = allArgs.slice(0, -1) as Parameters<T>;
            } else {
                args = allArgs as Parameters<T>;
            }
            if (options.forceRefresh) {
                return fn(...args);
            }
            const key = createApiCacheKey(this.baseURL, this.token, name, args);
            const cached = this.cache.get(key);
            if (cached !== undefined) {
                this.context.log.debug?.(`缓存命中: ${name}`);
                return Promise.resolve(cached);
            }

            const cachePromiseKey = `promise_${key}`;
            const existingPromise = this.cache.get(cachePromiseKey) as Promise<any> | undefined;

            if (existingPromise) {
                this.context.log.debug?.(`复用进行中的请求: ${name}`);
                return existingPromise;
            }

            const promise = fn(...args).then(result => {
                this.cache.del(cachePromiseKey);
                if (!result.success) return result;
                this.cache.set(key, result, options.ttl);
                this.context.log.debug?.(`缓存设置: ${name}, TTL: ${options.ttl}s`);
                return result;
            }).catch(error => {
                this.cache.del(cachePromiseKey);
                throw error;
            });

            this.cache.set(cachePromiseKey, promise, 30);
            return promise;
        }) as any;
    }

    getPlayInfo(itemGuid: string): Promise<ApiResponse<types.PlayInfo>> {
        const data: types.PlayInfoData = {
            item_guid: itemGuid,
        };
        return request(this.context, this.baseURL, '/v/api/v1/play/info', HttpMethod.POST, this.token, data);
    }

    setSkipInfo(parentGuid: string, skipStart: number, skipEnd: number): Promise<ApiResponse<unknown>> {
        const data: types.SetSkipInfoData = {
            guid: parentGuid,
            skip_opening: skipStart,
            skip_ending: skipEnd,
        };
        return request(this.context, this.baseURL, '/v/api/v1/play/setConfigByItem', HttpMethod.POST, this.token, data);
    }

    getPlayQuality(mediaGuid: string): Promise<ApiResponse<types.PlayQualityResponse>> {
        return request(this.context, this.baseURL, '/v/api/v1/play/quality', HttpMethod.POST, this.token, {
            media_guid: mediaGuid,
        });
    }

    getStreamList(itemGuid: string): Promise<ApiResponse<types.StreamListResponse>> {
        return request(this.context, this.baseURL, `/v/api/v1/stream/list/${itemGuid}`, HttpMethod.GET, this.token);
    }

    getStream(mediaGuid: string, ip: string): Promise<ApiResponse<types.StreamResponse>> {
        const data: types.StreamRequestData = {
            header: {
                "User-Agent": ["trim_player"]
            },
            level: 1,
            media_guid: mediaGuid,
            ip: ip,
        };

        return request(this.context, this.baseURL, '/v/api/v1/stream', HttpMethod.POST, this.token, data);
    }

    getVideoUrl(mediaGuid: string): string {
        return `${this.baseURL}/v/api/v1/media/range/${mediaGuid}`;
    }

    getPlayInfoCached = this.createCachedFunction(this.getPlayInfo.bind(this), 'getPlayInfo', 300);

    getPlayQualityCached = this.createCachedFunction(this.getPlayQuality.bind(this), 'getPlayQuality', 300);

    getStreamListCached = this.createCachedFunction(this.getStreamList.bind(this), 'getStreamList', 300);

    getStreamCached = this.createCachedFunction(this.getStream.bind(this), 'getStream', 300);
}
