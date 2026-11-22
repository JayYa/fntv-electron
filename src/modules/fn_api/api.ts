import * as fn from "./request";
import { HttpMethod } from "./request";
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import log from '../logger';
import * as types from './core/types';
import { TtlCache } from './core/ttlCache';
import { FnApiClient } from './core/apiClient';

const apiServiceCache = new TtlCache({ defaultTtl: 300 });

export class ApiService extends FnApiClient {
    private tempDir: string;

    constructor(baseURL: string, token: string = '', subtitleDir: string = path.join(app.getPath('temp'), 'fntv_subtitles')) {
        super(fn.mainContext, baseURL, token, apiServiceCache);
        this.tempDir = subtitleDir;

        this.downloadSubtitle = this.downloadSubtitle.bind(this);
    }

    private async cleanupSubtitleDirectory(): Promise<void> {
        try {
            let totalSize = 0;
            const files = fs.readdirSync(this.tempDir);

            for (const file of files) {
                const filePath = path.join(this.tempDir, file);
                const stats = fs.lstatSync(filePath);
                if (stats.isFile()) {
                    totalSize += stats.size;
                }
            }

            const maxSize = 100 * 1024 * 1024;
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

    login(username: string, password: string): Promise<fn.ApiResponse<any>> {
        return fn.request(this.baseURL, '/v/api/v1/login', HttpMethod.POST, this.token, {
            app_name: "trimemedia-web",
            username: username,
            password: password,
        } as types.LoginData);
    }

    getSysConfig(): Promise<fn.ApiResponse<types.SysConfigResponse>> {
        return fn.request(this.baseURL, '/v/api/v1/sys/config', HttpMethod.GET, this.token);
    }

    auth(code: string): Promise<fn.ApiResponse<types.AuthResponse>> {
        return fn.request(this.baseURL, '/v/api/v1/auth', HttpMethod.POST, this.token, {
            source: "Trim-NAS",
            code: code,
        } as types.AuthRequest);
    }

    logout(): Promise<fn.ApiResponse<any>> {
        return fn.request(this.baseURL, '/v/api/v1/logout', HttpMethod.POST, this.token);
    }

    getUserInfo(timeout?: number, tryTimes?: number): Promise<fn.ApiResponse<types.UserInfo>> {
        return fn.request(this.baseURL, '/v/api/v1/user/info', HttpMethod.GET, this.token, undefined, undefined, undefined, timeout, tryTimes);
    }

    getEpisodeListCached = this.createCachedFunction(this.getEpisodeList.bind(this), 'getEpisodeList', 600);

    getEpisodeList(id: string): Promise<fn.ApiResponse<types.PlayListItem[]>> {
        return fn.request(this.baseURL, `/v/api/v1/episode/list/${id}`, HttpMethod.GET, this.token);
    }

    getItemList(req: types.ItemListRequest): Promise<fn.ApiResponse<types.ItemListResponse>> {
        return fn.request(this.baseURL, '/v/api/v1/item/list', HttpMethod.POST, this.token, req);
    }

    getItemListCached = this.createCachedFunction(this.getItemList.bind(this), 'getItemList', 600);

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

    async downloadSubtitle(subs: types.Subtitle[]): Promise<string[]> {
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        } else {
            await this.cleanupSubtitleDirectory();
        }

        const downloadTasks = subs.map(sub => {
            const { id, name = id, format = 'srt' } = sub;
            const safeName = name.replace(/[^a-z0-9]/gi, '_');
            const filePath = path.join(this.tempDir, `${safeName}@${id}.${format}`);

            if (fs.existsSync(filePath)) {
                log.info(`⏭️  字幕文件已存在，跳过下载: ${filePath}`);
                return Promise.resolve({ id, filePath, success: true } as types.SubtitleDownloadResult);
            }

            return fn.requestRaw(this.baseURL, `/v/api/v1/subtitle/dl/${id}`, HttpMethod.GET, this.token)
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

        const results = await Promise.allSettled(downloadTasks);

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

    setWatched(itemGuid: string): Promise<fn.ApiResponse<any>> {
        return fn.request(this.baseURL, '/v/api/v1/item/watched', HttpMethod.POST, this.token, {
            item_guid: itemGuid,
        } as types.WatchedData);
    }

    savePlayRecord(record: types.PlayRecord): Promise<fn.ApiResponse<any>> {
        return fn.request(this.baseURL, '/v/api/v1/play/record', HttpMethod.POST, this.token, record);
    }

    getUserInfoCached = this.createCachedFunction(this.getUserInfo.bind(this), 'getUserInfo', 600);

}
