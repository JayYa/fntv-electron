import * as fn from "./request";
import { HttpMethod } from "./request";
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import log from '../logger';
import * as types from './core/types';
import { TtlCache } from './core/ttlCache';
import { FnApiClient } from './core/apiClient';

// 主进程的飞牛影视服务调用。和 Proxy 共用的调用及其缓存在 core/apiClient.ts。
const apiServiceCache = new TtlCache({ defaultTtl: 300 }); // 所有实例共享

export class ApiService extends FnApiClient {
    private tempDir: string;

    /**
     * 创建api服务实例
     * @param baseURL - API基础URL
     * @param token - 授权令牌
     * @param subtitleDir - 字幕下载目录，默认是系统临时目录下的 fntv_subtitles
     */
    constructor(baseURL: string, token: string = '', subtitleDir: string = path.join(app.getPath('temp'), 'fntv_subtitles')) {
        super(fn.mainContext, baseURL, token, apiServiceCache);
        this.tempDir = subtitleDir;

        this.downloadSubtitle = this.downloadSubtitle.bind(this);
    }

    /**
     * 清理字幕临时目录（当超过100MB时）
     */
    private async cleanupSubtitleDirectory(): Promise<void> {
        try {
            let totalSize = 0;
            const files = fs.readdirSync(this.tempDir);

            // 计算目录总大小
            for (const file of files) {
                const filePath = path.join(this.tempDir, file);
                const stats = fs.lstatSync(filePath);
                if (stats.isFile()) {
                    totalSize += stats.size;
                }
            }

            // 如果超过100MB（104857600字节），清理目录
            const maxSize = 100 * 1024 * 1024; // 100MB
            if (totalSize > maxSize) {
                log.info(`字幕目录大小 ${(totalSize / 1024 / 1024).toFixed(2)}MB 超过限制，开始清理...`);

                files.forEach(file => {
                    const filePath = path.join(this.tempDir, file);
                    if (fs.lstatSync(filePath).isFile()) {
                        fs.unlinkSync(filePath);
                    }
                });

                log.info('字幕目录清理完成');
            } else {
                log.info(`字幕目录大小 ${(totalSize / 1024 / 1024).toFixed(2)}MB，无需清理`);
            }
        } catch (error) {
            log.error('清理字幕目录时发生错误:', error);
        }
    }

    /**
    * 用户登录
    */
    login(username: string, password: string): Promise<fn.ApiResponse<any>> {
        return fn.request(this.baseURL, '/v/api/v1/login', HttpMethod.POST, this.token, {
            app_name: "trimemedia-web",
            username: username,
            password: password,
        } as types.LoginData);
    }

    /**
     * 获取系统配置（含 OAuth 信息）
     */
    getSysConfig(): Promise<fn.ApiResponse<types.SysConfigResponse>> {
        return fn.request(this.baseURL, '/v/api/v1/sys/config', HttpMethod.GET, this.token);
    }

    /**
     * OAuth 授权码换取令牌
     */
    auth(code: string): Promise<fn.ApiResponse<types.AuthResponse>> {
        return fn.request(this.baseURL, '/v/api/v1/auth', HttpMethod.POST, this.token, {
            source: "Trim-NAS",
            code: code,
        } as types.AuthRequest);
    }

    /**
     * 用户登出
     */
    logout(): Promise<fn.ApiResponse<any>> {
        return fn.request(this.baseURL, '/v/api/v1/logout', HttpMethod.POST, this.token);
    }

    /**
     * 获取用户信息
     */
    getUserInfo(timeout?: number, tryTimes?: number): Promise<fn.ApiResponse<types.UserInfo>> {
        return fn.request(this.baseURL, '/v/api/v1/user/info', HttpMethod.GET, this.token, undefined, undefined, undefined, timeout, tryTimes);
    }

    /**
     * 获取播放列表（带缓存）
     */
    getEpisodeListCached = this.createCachedFunction(this.getEpisodeList.bind(this), 'getEpisodeList', 600); // 10分钟缓存

    /**
     * 获取播放列表
     * @returns 返回播放列表的Promise
     */
    getEpisodeList(id: string): Promise<fn.ApiResponse<types.PlayListItem[]>> {
        return fn.request(this.baseURL, `/v/api/v1/episode/list/${id}`, HttpMethod.GET, this.token);
    }

    /**
     * 获取其他视频列表
     * @param req - 项目列表请求参数
     * @returns 返回项目列表的Promise
     */
    getItemList(req: types.ItemListRequest): Promise<fn.ApiResponse<types.ItemListResponse>> {
        return fn.request(this.baseURL, '/v/api/v1/item/list', HttpMethod.POST, this.token, req);
    }

    /** 获取其他视频列表（带缓存）
     */
    getItemListCached = this.createCachedFunction(this.getItemList.bind(this), 'getItemList', 600); // 10分钟缓存

    /**
     * 获取字幕文件列表
     * @param itemGuid - 视频项目的唯一标识符
     * @returns 返回字幕对象数组的Promise
     */
    async getSubtitle(itemGuid: string): Promise<types.Subtitle[]> {
        try {
            const response = await this.getStreamList(itemGuid);

            if (response.success && response.data) {
                const streams = response.data.subtitle_streams || [];
                const subtitles: types.Subtitle[] = streams.filter(stream => stream.is_external).map(stream => ({
                    id: stream.guid,
                    format: stream.format,
                    name: stream.title
                }));

                if (subtitles.length > 0) {
                    log.info('获取到字幕文件:', subtitles);
                    return subtitles;
                } else {
                    log.info('没有找到字幕文件');
                    return [];
                }
            } else {
                log.error('获取字幕列表失败:', response.message);
                return [];
            }
        } catch (error) {
            log.error('获取字幕列表时发生错误:', error);
            return [];
        }
    }

    /**
     * 下载字幕文件
     * @param subs - 字幕对象数组
     * @returns 返回下载成功的字幕文件路径数组
     */
    async downloadSubtitle(subs: types.Subtitle[]): Promise<string[]> {
        // 确保临时目录存在
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        } else {
            // 检查文件夹大小，超过100MB时清理
            await this.cleanupSubtitleDirectory();
        }

        // 准备下载任务
        const downloadTasks = subs.map(sub => {
            const { id, name = id, format = 'srt' } = sub;
            const safeName = name.replace(/[^a-z0-9]/gi, '_'); // 文件名安全处理
            const filePath = path.join(this.tempDir, `${safeName}@${id}.${format}`);

            // 检查文件是否已存在
            if (fs.existsSync(filePath)) {
                log.info(`⏭️  字幕文件已存在，跳过下载: ${filePath}`);
                return Promise.resolve({ id, filePath, success: true } as types.SubtitleDownloadResult);
            }

            return fn.request(this.baseURL, `/v/api/v1/subtitle/dl/${id}`, HttpMethod.GET, this.token)
                .then(response => {
                    if (response.success && response.data) {
                        return fs.promises.writeFile(filePath, response.data)
                            .then(() => {
                                log.info(`✅ 字幕文件已下载到: ${filePath}`);
                                return { id, filePath, success: true } as types.SubtitleDownloadResult;
                            });
                    } else {
                        log.error(`❌ 服务端错误: ${response.message} (ID: ${id})`);
                        return { id, filePath, success: false, error: `HTTP ${response.message}` } as types.SubtitleDownloadResult;
                    }
                })
                .catch((error: any) => {
                    let errorMsg = '未知错误';
                    if (error.response) {
                        errorMsg = `服务端错误: ${error.response.status}`;
                    } else if (error.request) {
                        errorMsg = '网络错误: 无响应';
                    } else {
                        errorMsg = `请求错误: ${error.message}`;
                    }
                    log.error(`❌ ID ${id} 下载失败: ${errorMsg}`);
                    return { id, filePath, success: false, error: errorMsg } as types.SubtitleDownloadResult;
                });
        });

        // 执行所有下载任务
        const results = await Promise.allSettled(downloadTasks);

        // 处理结果
        const successfulDownloads = results
            .filter((result): result is PromiseFulfilledResult<types.SubtitleDownloadResult> =>
                result.status === 'fulfilled' && result.value.success)
            .map(result => result.value.filePath);

        const failedCount = results.length - successfulDownloads.length;
        const skippedCount = subs.filter(sub => {
            const safeName = (sub.name || sub.id).replace(/[^a-z0-9]/gi, '_');
            const filePath = path.join(this.tempDir, `${safeName}.${sub.format || 'srt'}`);
            return fs.existsSync(filePath);
        }).length;
        const downloadedCount = successfulDownloads.length - skippedCount;

        log.info('========================================');
        log.info('字幕下载摘要:');
        log.info(`🔹 总数: ${subs.length}`);
        log.info(`📥 新下载: ${downloadedCount}`);
        log.info(`⏭️  跳过: ${skippedCount}`);
        log.info(`❌ 失败: ${failedCount}`);
        log.info('========================================');

        log.info('成功下载的字幕文件:', successfulDownloads);
        return successfulDownloads;
    }

    /**
     * 设置视频为已观看状态
     * @param itemGuid - 视频项目的唯一标识符
     * @returns 返回设置结果的Promise
     */
    setWatched(itemGuid: string): Promise<fn.ApiResponse<any>> {
        return fn.request(this.baseURL, '/v/api/v1/item/watched', HttpMethod.POST, this.token, {
            item_guid: itemGuid,
        } as types.WatchedData);
    }

    /**
     * 保存播放进度
     * @param record - 播放进度
     * @returns 返回记录结果的Promise
     */
    savePlayRecord(record: types.PlayRecord): Promise<fn.ApiResponse<any>> {
        return fn.request(this.baseURL, '/v/api/v1/play/record', HttpMethod.POST, this.token, record);
    }

    /**
     * 获取用户信息（带缓存）
     */
    getUserInfoCached = this.createCachedFunction(this.getUserInfo.bind(this), 'getUserInfo', 600);

}

// 重新导出类型定义，保持向后兼容
export * from './core/types';
