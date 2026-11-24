import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ChildProcess } from 'child_process';
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
import { MpvIpcSocket } from '../../../public/platform';
import { createPlaybackIpcSocket, removePlaybackIpcSocket } from './mpvIpcSocket';
import NodeMpv, { TimePosition } from 'node-mpv-2';

export class MpvPlayer implements Player {
    private config: Required<Config>;
    private globalStatus: PlayStatusData = { itemGuid: '', ts: 0, duration: 0, percentage: 0 };
    private mpvInstance: NodeMpv | null = null;
    private ipcSocket: MpvIpcSocket | null = null;
    private lastProgressTime: number = 0;
    private throttleInterval: number = 15000;
    private playlistItems: PlayItem[] = [];
    private playlistFilePath: string = '';
    private finished = false;

    constructor(config: Config) {
        this.config = {
            debug: false,
            extraArgs: [],
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
        if (this.finished) return;
        this.config.onEvent(...event);
    }

    async playList(infos: PlayItem[], pos: number): Promise<boolean> {
        try {
            const mpvArgs = [...this.config.extraArgs];

            this.ipcSocket = createPlaybackIpcSocket();
            const mpvOptions = {
                debug: this.config.debug,
                binary: this.config.playerPath.length > 0 ? this.config.playerPath : undefined,
                socket: this.ipcSocket.path,
                auto_restart: false,
            };

            const mpv = new NodeMpv(mpvOptions, mpvArgs);
            this.mpvInstance = mpv;

            this.setupEventListeners();

            await mpv.start();
            if (this.finished) {
                this.quitMpv(mpv);
                return false;
            }
            this.watchProcessClose();

            await this.loadPlaylistItems(infos, pos);

            if (this.config.debug) {
                log.debug('MPV 实例启动成功');
            }

            return true;

        } catch (error: any) {
            log.error('MPV 初始化失败:', error);
            const errorEvent: PlayErrorData = {
                message: error.message || error.toString()
            };
            this.emitEvent(EventType.ERROR, errorEvent);
            this.abandon();
            return false;
        }
    }

    private async loadPlaylistItems(infos: PlayItem[], pos: number): Promise<void> {
        if (!this.mpvInstance || infos.length === 0) {
            throw new Error('MPV实例未启动或播放列表为空');
        }

        try {
            this.playlistItems = infos;

            const playlistContent = this.generateM3U8Playlist(infos);
            this.playlistFilePath = path.join(os.tmpdir(), `mpv_playlist_${Date.now()}.m3u8`);

            await fs.promises.writeFile(this.playlistFilePath, playlistContent, 'utf-8');

            if (this.config.debug) {
                log.debug(`生成播放列表文件: ${this.playlistFilePath}`);
                log.debug(`播放列表已生成，共 ${infos.length} 项`);
            }

            await this.mpvInstance.loadPlaylist(this.playlistFilePath, 'replace');

            if (pos > 0) {
                this.switchToItem(pos);
                await this.mpvInstance.setProperty('playlist-pos', pos);
                if (this.config.debug) {
                    log.debug(`跳转到播放列表位置: ${pos} (${infos[pos].title})`);
                }
            }

            if (this.config.debug) {
                log.debug(`播放列表加载完成，当前播放: ${infos[pos].title}`);
            }
        } catch (error: any) {
            log.error('加载播放列表失败:', error);
            throw error;
        }
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

        for (let i = 0; i < infos.length; i++) {
            const item = infos[i];
            const title = this.getTitle(item);

            const duration = item.duration || -1;

            content += `#EXTINF:${duration},${title}\n`;
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
            if (this.config.debug) {
                log.debug('播放项结束:', previous);
            }
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

    private setupEventListeners(): void {
        if (!this.mpvInstance) return;

        this.startProgressMonitoring();

        this.mpvInstance.on('stopped', () => {
            log.info('MPV 播放结束');
        });

        this.mpvInstance.on('crashed', () => {
            log.error('MPV 播放器崩溃');
            const errorEvent: PlayErrorData = {
                message: 'MPV 播放器崩溃'
            };
            this.emitEvent(EventType.ERROR, errorEvent);
            this.removeIpcSocket();
            this.handleExit(1);
        });

        this.mpvInstance.on('quit', () => {
            this.removeIpcSocket();
            this.handleExit(0);
        });

        this.mpvInstance.on('status', (status: any) => {
            if (this.config.debug) {
                log.debug('MPV 状态变化:', status);
            }

            if (status.property === 'playlist-pos' && typeof status.value === 'number') {
                this.switchToItem(status.value);
            }

            if (status.property === 'volume' && typeof status.value === 'number') {
                this.config.onVolumeChange(status.value);
            }

            if (status.property === 'path' && typeof status.value === 'string') {
                const currentItem = this.findItem(status.value);
                if (!currentItem) {
                    if (this.config.debug) {
                        log.debug('path changed: 不是播放列表里的播放项:', status.value);
                    }
                    return;
                }

                this.mpvInstance?.setProperty('force-media-title', this.getTitle(currentItem)).catch(err => {
                    if (this.config.debug) {
                        log.debug('设置窗口标题失败:', err);
                    }
                });

                const position = this.config.resumePosition(currentItem);
                if (position > 0) {
                    this.seekWithRetry(position, 50000, 10);
                }

                this.config.loadSubtitles(currentItem.itemGuid)
                    .then(subPaths => {
                        subPaths.forEach(subPath => {
                            const subName = path.basename(subPath).split("@")[0];
                            this.mpvInstance?.addSubtitles(subPath, "select", subName).catch(err => {
                                if (this.config.debug) {
                                    log.debug('加载字幕失败:', err);
                                }
                            });
                        });
                    })
                    .catch(err => log.warn('获取字幕失败:', err instanceof Error ? err.message : String(err)));
            }
        });

        this.mpvInstance.on('seek', (t: TimePosition) => {
            if (this.config.debug) {
                log.debug('Seek event detected, new position:', t);
            }

            const st = this.statusSnapshot();
            st.ts = Math.floor(t.end);

            this.saveCurrentItemStatus(st);
            this.updateGlobalStatus(st);
            this.emitEvent(EventType.PROGRESS, st);
        });
    }

    private async seekWithRetry(position: number, maxRetries: number, delayMs: number): Promise<void> {
        let retryCount = 0;

        const attemptSeek = async (): Promise<void> => {
            return new Promise((resolve, reject) => {
                setTimeout(async () => {
                    if (!this.mpvInstance || !this.mpvInstance.isRunning()) {
                        reject(new Error('MPV 实例不存在或未运行'));
                        return;
                    }

                    try {
                        await this.mpvInstance.goToPosition(position);
                        if (this.config.debug) {
                            log.info(`跳转成功: 位置 ${position}s ${retryCount > 0 ? `(重试 ${retryCount} 次后成功)` : ''}`);
                        }
                        resolve();
                    } catch (error) {
                        retryCount++;
                        if (retryCount <= maxRetries) {
                            setTimeout(() => {
                                attemptSeek().then(resolve).catch(reject);
                            }, delayMs);
                        } else {
                            log.info(`跳转失败，已达到最大重试次数 ${maxRetries} (位置: ${position}s):`, error);
                            reject(error);
                        }
                    }
                }, delayMs);
            });
        };

        try {
            await attemptSeek();
        } catch (error) {
            if (this.config.debug) {
                log.debug('path changed: 跳转到指定时间点最终失败:', error);
            }
        }
    }

    private findItem(mpvPath: string): PlayItem | undefined {
        return this.playlistItems.find(item => item.playLink === mpvPath);
    }

    private startProgressMonitoring(): void {
        this.mpvInstance?.on('timeposition', async (currentTime: number) => {
            if (!this.mpvInstance || !this.mpvInstance.isRunning()) {
                return;
            }

            const [duration, percentage, mpvPath] = await Promise.all([
                this.mpvInstance.getDuration().catch(() => 0),
                this.mpvInstance.getPercentPosition().catch(() => 0),
                this.mpvInstance.getFilename().catch(() => '')
            ]);

            if (duration === 0) {
                log.warn('视频时长为 0，无法获取进度信息');
                return;
            }

            const itemGuid = this.findItem(String(mpvPath))?.itemGuid;
            if (!itemGuid) {
                log.warn('当前播放的不是播放列表里的播放项:', mpvPath);
                return;
            }

            const progressData: PlayStatusData = this.statusSnapshot();
            progressData.itemGuid = itemGuid;
            progressData.ts = Math.floor(currentTime);
            progressData.duration = Math.floor(duration);
            progressData.percentage = Math.floor(percentage);

            this.saveCurrentItemStatus(progressData);
            this.updateGlobalStatus(progressData);
            const now = Date.now();
            if (now - this.lastProgressTime >= this.throttleInterval) {
                this.emitEvent(EventType.PROGRESS, progressData);
                this.lastProgressTime = now;
            }
        });
    }

    private watchProcessClose(): void {
        const mpvProcess = (this.mpvInstance as unknown as { mpvPlayer?: ChildProcess } | null)?.mpvPlayer;
        mpvProcess?.once('close', (code: number | null) => {
            this.removeIpcSocket();
            this.handleExit(typeof code === 'number' ? code : 1);
        });
    }

    private abandon(): void {
        this.finished = true;
        this.quitMpv(this.mpvInstance);
        this.cleanupPlaylistFile();
        this.mpvInstance = null;
    }

    private handleExit(code: number): void {
        if (this.finished) return;
        this.cleanupPlaylistFile();

        const event: PlayExitData = {
            code: code,
            status: this.statusSnapshot()
        };

        this.finished = true;
        this.config.onEvent(EventType.EXIT, event);

        if (this.config.debug) {
            if (code !== 0) {
                log.error(`播放异常结束 (code ${code})`);
            } else {
                log.info('播放器正常退出');
            }
        }

        this.mpvInstance = null;
    }

    private cleanupPlaylistFile(): void {
        if (this.playlistFilePath && fs.existsSync(this.playlistFilePath)) {
            try {
                fs.unlinkSync(this.playlistFilePath);
                if (this.config.debug) {
                    log.debug(`已清理播放列表文件: ${this.playlistFilePath}`);
                }
            } catch (error) {
                if (this.config.debug) {
                    log.debug('清理播放列表文件失败:', error);
                }
            }
            this.playlistFilePath = '';
        }
    }

    private removeIpcSocket(): void {
        removePlaybackIpcSocket(this.ipcSocket, (error) => log.debug('清理 MPV IPC socket 失败:', error));
        this.ipcSocket = null;
    }

    private quitMpv(mpv: NodeMpv | null): void {
        if (!mpv) return;
        try {
            mpv.quit().catch((error: any) => {
                if (this.config.debug) {
                    log.debug('停止播放时出错:', error);
                }
            }).finally(() => {
                this.removeIpcSocket();
            });
        } catch (error) {
            if (this.config.debug) {
                log.debug('停止播放异常:', error);
            }
        }
    }

    stop(): void {
        if (this.mpvInstance) {
            log.info('停止播放');
            this.quitMpv(this.mpvInstance);
            this.handleExit(0);
        } else {
            this.cleanupPlaylistFile();
        }
    }
}
