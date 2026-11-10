// 主进程和 Proxy 都要用的飞牛影视服务调用及其缓存。只依赖调用方传入的 RequestContext 和缓存实例。
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

    /**
     * @param context - 访问授权、证书信任和日志，由调用方所在进程提供
     * @param baseURL - 飞牛影视服务地址，末尾的 / 会去掉
     * @param token - 授权令牌
     * @param cache - 带缓存的调用共用的缓存，同一个缓存里的结果按地址和令牌区分
     */
    constructor(context: RequestContext, baseURL: string, token: string, cache: TtlCache) {
        this.context = context;
        this.baseURL = baseURL.replace(/\/+$/, '');
        this.token = token;
        this.cache = cache;
    }

    /** 获取当前API基础URL */
    getBaseURL(): string {
        return this.baseURL;
    }

    /**
     * 创建带缓存的函数版本
     * @param fn - 要缓存的函数
     * @param defaultTtl - 默认缓存过期时间（秒），默认为300秒（5分钟）
     * @returns 返回带缓存的函数，支持可选的 options 参数
     */
    protected createCachedFunction<T extends (...args: any[]) => Promise<any>>(
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

            // 使用缓存的promise来避免并发竞争条件
            const cachePromiseKey = `promise_${key}`;
            const existingPromise = this.cache.get(cachePromiseKey) as Promise<any> | undefined;

            if (existingPromise) {
                this.context.log.debug?.(`复用进行中的请求: ${name}`);
                return existingPromise;
            }

            const promise = fn(...args).then(result => {
                this.cache.set(key, result, options.ttl);
                this.cache.del(cachePromiseKey); // 清理promise缓存
                this.context.log.debug?.(`缓存设置: ${name}, TTL: ${options.ttl}s`);
                return result;
            }).catch(error => {
                this.cache.del(cachePromiseKey); // 清理promise缓存
                throw error;
            });

            // 临时缓存promise以避免并发重复请求
            this.cache.set(cachePromiseKey, promise, 30); // promise缓存30秒
            return promise;
        }) as any;
    }

    /**
     * 获取视频播放信息
     * @param itemGuid - 视频项目的唯一标识符
     */
    getPlayInfo(itemGuid: string): Promise<ApiResponse<types.PlayInfo>> {
        const data: types.PlayInfoData = {
            item_guid: itemGuid,
        };
        return request(this.context, this.baseURL, '/v/api/v1/play/info', HttpMethod.POST, this.token, data);
    }

    /**
     * 写入片头片尾信息。飞牛影视服务按播放项的父级记录，不按播放项本身。
     * @param parentGuid - 播放项的 parent_guid
     * @param skipStart - 片头结束的时间点（秒）
     * @param skipEnd - 片尾开始的时间点（秒）
     */
    setSkipInfo(parentGuid: string, skipStart: number, skipEnd: number): Promise<ApiResponse<unknown>> {
        const data: types.SetSkipInfoData = {
            guid: parentGuid,
            skip_opening: skipStart,
            skip_ending: skipEnd,
        };
        return request(this.context, this.baseURL, '/v/api/v1/play/setConfigByItem', HttpMethod.POST, this.token, data);
    }

    /**
     * 获取播放质量列表
     * @param mediaGuid - 媒体文件的唯一标识符
     */
    getPlayQuality(mediaGuid: string): Promise<ApiResponse<types.PlayQualityResponse>> {
        return request(this.context, this.baseURL, '/v/api/v1/play/quality', HttpMethod.POST, this.token, {
            media_guid: mediaGuid,
        });
    }

    /**
     * 获取流列表（包括视频、音频、字幕流）
     * @param itemGuid - 视频项目的唯一标识符
     */
    getStreamList(itemGuid: string): Promise<ApiResponse<types.StreamListResponse>> {
        return request(this.context, this.baseURL, `/v/api/v1/stream/list/${itemGuid}`, HttpMethod.GET, this.token);
    }

    /**
     * 获取流信息（包括视频、音频、字幕流和质量信息）
     * @param mediaGuid - 媒体文件的唯一标识符
     * @param ip - IP地址
     */
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

    /**
     * 获取视频直链地址
     * @param mediaGuid - 视频项目的唯一标识符
     */
    getVideoUrl(mediaGuid: string): string {
        return `${this.baseURL}/v/api/v1/media/range/${mediaGuid}`;
    }

    /** 获取视频播放信息（带缓存，5分钟） */
    getPlayInfoCached = this.createCachedFunction(this.getPlayInfo.bind(this), 'getPlayInfo', 300);

    /** 获取播放质量列表（带缓存，5分钟） */
    getPlayQualityCached = this.createCachedFunction(this.getPlayQuality.bind(this), 'getPlayQuality', 300);

    /** 获取流列表（带缓存，5分钟） */
    getStreamListCached = this.createCachedFunction(this.getStreamList.bind(this), 'getStreamList', 300);

    /** 获取流信息（带缓存，5分钟） */
    getStreamCached = this.createCachedFunction(this.getStream.bind(this), 'getStream', 300);
}
