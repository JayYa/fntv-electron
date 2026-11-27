import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import * as log from '../logger';
import * as types from './core/types';
import { TtlCache } from './core/ttlCache';
import { FnApiClient } from './core/apiClient';
import { RequestContext } from './core/request';
import { isTrusted } from '../cert_trust';
import { getAccessCookieHeader } from './accessGrant';

const mainContext: RequestContext = {
    accessCookie: getAccessCookieHeader,
    skipVerify: isTrusted,
    log,
};

const apiServiceCache = new TtlCache({ defaultTtl: 300 });

export class ApiService extends FnApiClient {
    private tempDir: string;

    constructor(baseURL: string, token: string = '', subtitleDir: string = path.join(app.getPath('temp'), 'fntv_subtitles')) {
        super(mainContext, baseURL, token, apiServiceCache);
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

    async getSubtitle(itemGuid: string): Promise<types.Subtitle[]> {
        const response = await this.getStreamList(itemGuid);
        if (!response.ok) {
            log.error('获取字幕列表失败:', response.failure.message);
            return [];
        }

        const streams = response.data.subtitle_streams || [];
        const subtitles: types.Subtitle[] = streams.filter(stream => stream.is_external).map(stream => ({
            id: stream.guid,
            format: stream.format,
            name: stream.title
        }));

        if (subtitles.length === 0) {
            log.info('没有找到字幕文件');
            return [];
        }
        log.info('获取到字幕文件:', subtitles);
        return subtitles;
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
                return Promise.resolve({ id, filePath, status: 'skipped' } as types.SubtitleDownloadResult);
            }

            return this.getSubtitleFile(id)
                .then(response => {
                    if (response.ok) {
                        return fs.promises.writeFile(filePath, response.data)
                            .then(() => {
                                log.info(`✅ 字幕文件已下载到: ${filePath}`);
                                return { id, filePath, status: 'downloaded' } as types.SubtitleDownloadResult;
                            });
                    } else {
                        log.error(`❌ 服务端错误: ${response.failure.message} (ID: ${id})`);
                        return { id, filePath, status: 'failed', error: `HTTP ${response.failure.message}` } as types.SubtitleDownloadResult;
                    }
                })
                .catch((error: any) => {
                    const errorMsg = `写入失败: ${error.message}`;
                    log.error(`❌ ID ${id} 下载失败: ${errorMsg}`);
                    return { id, filePath, status: 'failed', error: errorMsg } as types.SubtitleDownloadResult;
                });
        });

        const results = await Promise.all(downloadTasks);

        const successfulDownloads = results
            .filter(result => result.status !== 'failed')
            .map(result => result.filePath);

        const countOf = (status: types.SubtitleDownloadStatus) => results.filter(result => result.status === status).length;
        const downloadedCount = countOf('downloaded');
        const skippedCount = countOf('skipped');
        const failedCount = countOf('failed');

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
}
