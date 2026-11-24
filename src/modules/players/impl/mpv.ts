import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    Config,
    PlayStatusData,
    EventType,
    PlayErrorData,
    PlayExitData,
    PlayItem,
    Player,
    PlayerEvent,
} from '../types';
import * as log from '../../logger';
import { MpvProcess } from './mpvProcess';

const PROGRESS_INTERVAL_MS = 15000;
const SEEK_TIMEOUT_MS = 30000;
const SEEK_RETRY_DELAY_MS = 10;

export class MpvPlayer implements Player {
    private config: Required<Config>;
    private globalStatus: PlayStatusData = { itemGuid: '', ts: 0, duration: 0, percentage: 0 };
    private process: MpvProcess | null = null;
    private lastProgressTime: number = 0;
    private playlistItems: PlayItem[] = [];
    private playlistFilePath: string = '';
    private stopRequested = false;
    private abandoned = false;
    private itemGeneration = 0;

    constructor(config: Config) {
        this.config = {
            onVolumeChange: () => undefined,
            ...config,
        };
    }

    private statusSnapshot(): PlayStatusData {
        return { ...this.globalStatus };
    }

    private updateGlobalStatus(status: PlayStatusData): void {
        this.globalStatus = { ...status };
    }

    private emitEvent(...event: PlayerEvent): void {
        this.config.onEvent(...event);
    }

    async playList(infos: PlayItem[], pos: number): Promise<boolean> {
        if (this.stopRequested) {
            return false;
        }
        const mpv = this.config.createMpvProcess({
            onProperty: (property, value) => this.handleProperty(mpv, property, value),
            onTimePosition: (seconds) => void this.handleTimePosition(mpv, seconds),
            onSeek: (seconds) => this.handleSeek(seconds),
            onExit: (code) => this.handleExit(code),
        });
        this.process = mpv;

        try {
            await mpv.start();
        } catch (error) {
            this.process = null;
            if (!this.stopRequested) {
                this.fail('MPV 初始化失败:', error);
            }
            return false;
        }

        try {
            await this.loadPlaylistItems(mpv, infos, pos);
        } catch (error) {
            if (this.stopRequested) {
                return true;
            }
            this.fail('加载播放列表失败:', error);
            this.abandoned = true;
            mpv.stop();
            return false;
        }

        log.debug('MPV 进程启动成功');
        return true;
    }

    private fail(message: string, error: unknown): void {
        log.error(message, error);
        const errorEvent: PlayErrorData = {
            message: error instanceof Error ? error.message : String(error),
        };
        this.emitEvent(EventType.ERROR, errorEvent);
    }

    private async loadPlaylistItems(mpv: MpvProcess, infos: PlayItem[], pos: number): Promise<void> {
        if (infos.length === 0) {
            throw new Error('播放列表为空');
        }

        this.playlistItems = infos.map(item => ({ ...item }));
        this.playlistFilePath = path.join(os.tmpdir(), `mpv_playlist_${Date.now()}.m3u8`);
        await fs.promises.writeFile(this.playlistFilePath, this.generateM3U8Playlist(infos), 'utf-8');
        log.debug(`生成播放列表文件: ${this.playlistFilePath}，共 ${infos.length} 项`);

        await mpv.loadPlaylist(this.playlistFilePath);

        if (pos > 0) {
            this.switchToItem(pos);
            await mpv.setProperty('playlist-pos', pos);
        }
        log.debug(`播放列表加载完成，当前播放: ${infos[pos].title}`);
    }

    private getTitle(info: PlayItem): string {
        let title = info.title || '';
        if (info.tvTitle) {
            title = `${info.tvTitle || 'noTVTitle'} - S${info.seasonNumber || '0'}E${info.episodeNumber || '0'}: ${info.title || 'noTitle'}`;
        }

        return title;
    }

    private generateM3U8Playlist(infos: PlayItem[]): string {
        let content = '#EXTM3U\n';

        for (const item of infos) {
            const duration = item.duration || -1;
            content += `#EXTINF:${duration},${this.getTitle(item)}\n`;
            content += `${item.playLink}\n`;
        }

        return content;
    }

    private switchToItem(index: number): void {
        const previous = this.statusSnapshot();
        const next = this.playlistItems[index];
        const hadPrevious = previous.itemGuid.length > 0;
        const stillSameItem = next?.itemGuid === previous.itemGuid;

        if (hadPrevious && !stillSameItem) {
            log.debug('播放项结束:', previous);
            this.emitEvent(EventType.ITEM_END, previous);
        }

        if (next) {
            this.updateGlobalStatus({
                itemGuid: next.itemGuid,
                ts: next.ts,
                duration: next.duration,
                percentage: next.duration > 0 ? Math.floor((next.ts / next.duration) * 100) : 0,
            });
        }
    }

    private saveCurrentItemStatus(status: PlayStatusData): void {
        const item = this.playlistItems.find(i => i.itemGuid === status.itemGuid);
        if (item) {
            item.ts = status.ts;
        }
    }

    private handleProperty(mpv: MpvProcess, property: string, value: unknown): void {
        log.debug('MPV 状态变化:', property, value);

        if (property === 'playlist-pos' && typeof value === 'number') {
            this.switchToItem(value);
        }

        if (property === 'volume' && typeof value === 'number') {
            this.config.onVolumeChange(value);
        }

        if (property === 'path' && typeof value === 'string') {
            this.startItem(mpv, value);
        }
    }

    private startItem(mpv: MpvProcess, mpvPath: string): void {
        const generation = ++this.itemGeneration;
        const currentItem = this.findItem(mpvPath);
        if (!currentItem) {
            log.debug('path changed: 不是播放列表里的播放项:', mpvPath);
            return;
        }

        mpv.setProperty('force-media-title', this.getTitle(currentItem)).catch(err => {
            log.debug('设置窗口标题失败:', err);
        });

        const position = this.config.resumePosition(currentItem);
        if (position > 0) {
            void this.seekWithRetry(mpv, position, generation);
        }

        this.config.loadSubtitles(currentItem.itemGuid)
            .then(subPaths => {
                subPaths.forEach(subPath => {
                    const subName = path.basename(subPath).split("@")[0];
                    mpv.addSubtitles(subPath, subName).catch(err => {
                        log.debug('加载字幕失败:', err);
                    });
                });
            })
            .catch(err => log.warn('获取字幕失败:', err instanceof Error ? err.message : String(err)));
    }

    private handleSeek(seconds: number): void {
        const st = this.statusSnapshot();
        st.ts = Math.floor(seconds);

        this.saveCurrentItemStatus(st);
        this.updateGlobalStatus(st);
        this.emitEvent(EventType.PROGRESS, st);
    }

    private async seekWithRetry(mpv: MpvProcess, position: number, generation: number): Promise<void> {
        const deadline = Date.now() + SEEK_TIMEOUT_MS;
        for (let attempt = 0; ; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, SEEK_RETRY_DELAY_MS));
            if (this.process !== mpv || this.stopRequested || this.itemGeneration !== generation) {
                return;
            }
            try {
                await mpv.seekTo(position);
                log.debug(`跳转成功: 位置 ${position}s ${attempt > 0 ? `(重试 ${attempt} 次后成功)` : ''}`);
                return;
            } catch (error) {
                if (Date.now() >= deadline) {
                    log.info(`跳转失败，${SEEK_TIMEOUT_MS / 1000} 秒内 MPV 未接受跳转 (位置: ${position}s):`, error);
                    return;
                }
            }
        }
    }

    private findItem(mpvPath: string): PlayItem | undefined {
        return this.playlistItems.find(item => item.playLink === mpvPath);
    }

    private async handleTimePosition(mpv: MpvProcess, currentTime: number): Promise<void> {
        const info = await mpv.playbackInfo().catch(() => null);
        if (!info || this.process !== mpv || this.stopRequested) {
            return;
        }

        if (info.duration === 0) {
            log.warn('视频时长为 0，无法获取进度信息');
            return;
        }

        const itemGuid = this.findItem(info.path)?.itemGuid;
        if (!itemGuid) {
            log.warn('当前播放的不是播放列表里的播放项:', info.path);
            return;
        }

        const progressData: PlayStatusData = {
            itemGuid,
            ts: Math.floor(currentTime),
            duration: Math.floor(info.duration),
            percentage: Math.floor(info.percentage),
        };

        this.saveCurrentItemStatus(progressData);
        this.updateGlobalStatus(progressData);
        const now = Date.now();
        if (now - this.lastProgressTime >= PROGRESS_INTERVAL_MS) {
            this.emitEvent(EventType.PROGRESS, progressData);
            this.lastProgressTime = now;
        }
    }

    private handleExit(code: number): void {
        this.process = null;
        this.cleanupPlaylistFile();
        if (this.abandoned) {
            return;
        }

        const event: PlayExitData = {
            code,
            status: this.statusSnapshot(),
        };
        this.emitEvent(EventType.EXIT, event);
        log.info(code === 0 ? '播放器正常退出' : `播放异常结束 (code ${code})`);
    }

    private cleanupPlaylistFile(): void {
        if (this.playlistFilePath && fs.existsSync(this.playlistFilePath)) {
            try {
                fs.unlinkSync(this.playlistFilePath);
                log.debug(`已清理播放列表文件: ${this.playlistFilePath}`);
            } catch (error) {
                log.debug('清理播放列表文件失败:', error);
            }
        }
        this.playlistFilePath = '';
    }

    stop(): void {
        if (this.stopRequested) return;
        this.stopRequested = true;
        log.info('停止播放');
        if (this.process) {
            this.process.stop();
        } else {
            this.cleanupPlaylistFile();
        }
    }
}
