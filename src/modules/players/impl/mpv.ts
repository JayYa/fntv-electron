import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    Config,
    EventData,
    PlayStatusData,
    EventType,
    PlayErrorData,
    PlayExitData,
    PlayItem,
    Player,
} from '../types';
import log from '../../logger';
import { MpvIpcSocket } from '../../../public/platform';
import { createPlaybackIpcSocket, removePlaybackIpcSocket } from './mpvIpcSocket';
import NodeMpv, { TimePosition } from 'node-mpv-2';

export class MpvPlayer implements Player {
    private config: Required<Config>;
    private globalStatus: PlayStatusData = { itemGuid: '', ts: 0, duration: 0, percentage: 0 };
    private mpvInstance: NodeMpv | null = null;
    // 这次播放的 IPC 地址，不用 node-mpv-2 的固定默认值
    private ipcSocket: MpvIpcSocket | null = null;
    // 节流调用
    private lastProgressTime: number = 0;
    private throttleInterval: number = 15000; // 15秒间隔（毫秒）
    // 播放列表相关
    private playlistItems: PlayItem[] = [];
    private playlistFilePath: string = '';

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

    private emitEvent(type: EventType, event: EventData): void {
        this.config.onEvent(type, event);
    }

    /**
     * 播放媒体列表
     */
    async playList(infos: PlayItem[], pos: number): Promise<boolean> {
        try {
            const mpvArgs = [...this.config.extraArgs];

            this.ipcSocket = createPlaybackIpcSocket();
            const mpvOptions = {
                debug: this.config.debug,
                binary: this.config.playerPath.length > 0 ? this.config.playerPath : undefined,
                socket: this.ipcSocket.path,
            };

            this.mpvInstance = new NodeMpv(mpvOptions, mpvArgs);

            // 设置事件监听器
            this.setupEventListeners();

            // 启动 MPV 并加载媒体
            await this.mpvInstance.start()

            // 将所有的infos按顺序加入播放列表，并且播放第pos个视频
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
            return false;
        }
    }

    /**
     * 生成并加载播放列表文件
     */
    private async loadPlaylistItems(infos: PlayItem[], pos: number): Promise<void> {
        if (!this.mpvInstance || infos.length === 0) {
            throw new Error('MPV实例未启动或播放列表为空');
        }

        try {
            // 保存播放列表信息
            this.playlistItems = infos;

            // 生成 M3U8 播放列表文件
            const playlistContent = this.generateM3U8Playlist(infos);
            this.playlistFilePath = path.join(os.tmpdir(), `mpv_playlist_${Date.now()}.m3u8`);

            await fs.promises.writeFile(this.playlistFilePath, playlistContent, 'utf-8');

            if (this.config.debug) {
                log.debug(`生成播放列表文件: ${this.playlistFilePath}`);
                log.debug(`播放列表已生成，共 ${infos.length} 项`);
            }

            // 加载播放列表文件
            await this.mpvInstance.loadPlaylist(this.playlistFilePath, 'replace');

            // 跳转到指定位置
            if (pos > 0) {
                this.switchToItem(pos);
                // 这个函数如果await的话有可能会卡死，有点坑
                this.mpvInstance.jump(pos);
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

    /**
     * 获取视频标题
     */
    private getTitle(info: PlayItem): string {
        // 构建标题
        let title = info.title || '';
        if (info.tvTitle) {
            title = `${info.tvTitle || 'noTVTitle'} - S${info.seasonNumber || '0'}E${info.episodeNumber || '0'}: ${info.title || 'noTitle'}`;
        }

        // 补充一个item_id用于区分当前是哪个视频
        // title = `${title}@${info.itemGuid}`;
        return title;
    }

    /**
     * 生成 M3U8 播放列表内容
     */
    private generateM3U8Playlist(infos: PlayItem[]): string {
        let content = '#EXTM3U\n';

        for (let i = 0; i < infos.length; i++) {
            const item = infos[i];
            const title = this.getTitle(item);

            // 使用实际时长，如果没有则使用 -1
            const duration = item.duration || -1;

            // 添加扩展信息，包含播放进度
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

    /**
     * 保存当前播放项状态
     * @param status 播放状态数据
     * @param itemGuid 当前播放项 GUID
     */
    private saveCurrentItemStatus(status: PlayStatusData): void {
        const item = this.playlistItems.find(i => i.itemGuid === status.itemGuid);
        if (item) {
            item.ts = status.ts;
        }
    }

    /**
     * 设置事件监听器
     */
    private setupEventListeners(): void {
        if (!this.mpvInstance) return;

        // 开始进度监控
        this.startProgressMonitoring();

        // 监听播放结束事件
        this.mpvInstance.on('stopped', () => {
            // this.handleExit(0);
            log.info('MPV 播放结束');
        });

        // 监听错误事件
        this.mpvInstance.on('crashed', () => {
            log.error('MPV 播放器崩溃');
            const errorEvent: PlayErrorData = {
                message: 'MPV 播放器崩溃'
            };
            this.emitEvent(EventType.ERROR, errorEvent);
            this.handleExit(1);
        });

        // 监听退出事件
        this.mpvInstance.on('quit', () => {
            // MPV 进程已经退出，socket 文件不会再用
            this.removeIpcSocket();
            this.handleExit(0);
        });

        // 监听状态变化
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

            // 监听播放路径位置
            if (status.property === 'path' && typeof status.value === 'string') {
                // 先报的是播放列表文件本身，认不出时忽略
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
                            const subName = path.basename(subPath).split("@")[0]; // 获取原始字幕名称
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

        // 监听跳转事件
        this.mpvInstance.on('seek', (t: TimePosition) => {
            // Handle seek events
            if (this.config.debug) {
                log.debug('Seek event detected, new position:', t);
            }

            // 通知更新跳转
            const st = this.statusSnapshot();
            st.ts = Math.floor(t.end);

            // 保存到全局的playlist
            this.saveCurrentItemStatus(st);
            this.updateGlobalStatus(st);
            this.emitEvent(EventType.PROGRESS, st);
        });
    }

    /**
     * 带重试机制的跳转函数
     * @param position 跳转位置（秒）
     * @param maxRetries 最大重试次数
     * @param delayMs 每次重试的延迟时间（毫秒）
     */
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
                            // 重试，使用固定延迟时间
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
            // 最终失败，记录错误但不抛出异常
            if (this.config.debug) {
                log.debug('path changed: 跳转到指定时间点最终失败:', error);
            }
        }
    }

    /** MPV 的 path 属性原样报回播放列表里的地址，按它找到对应的播放项。 */
    private findItem(mpvPath: string): PlayItem | undefined {
        return this.playlistItems.find(item => item.playLink === mpvPath);
    }

    /**
     * 开始进度监控
     */
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

            // 保存当前播放项状态
            this.saveCurrentItemStatus(progressData);
            // 更新全局状态
            this.updateGlobalStatus(progressData);
            // 节流处理
            const now = Date.now();
            if (now - this.lastProgressTime >= this.throttleInterval) {
                this.emitEvent(EventType.PROGRESS, progressData);
                this.lastProgressTime = now;
            }
        });
    }

    /**
     * 处理退出事件
     */
    private handleExit(code: number): void {
        // 清理播放列表文件
        this.cleanupPlaylistFile();

        // 发射退出事件
        const event: PlayExitData = {
            code: code,
            status: this.statusSnapshot()
        };

        this.emitEvent(EventType.EXIT, event);

        if (this.config.debug) {
            if (code !== 0) {
                log.error(`播放异常结束 (code ${code})`);
            } else {
                log.info('播放器正常退出');
            }
        }

        // 清理实例引用
        this.mpvInstance = null;
    }

    /**
     * 清理播放列表文件
     */
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

    /** 只在 MPV 退出后或 quit() 返回后调用，原因见 removePlaybackIpcSocket。 */
    private removeIpcSocket(): void {
        removePlaybackIpcSocket(this.ipcSocket, (error) => log.debug('清理 MPV IPC socket 失败:', error));
        this.ipcSocket = null;
    }

    /**
     * 停止播放
     */
    stop(): void {
        if (this.mpvInstance) {
            try {
                log.info('停止播放');
                this.mpvInstance.quit().catch((error: any) => {
                    if (this.config.debug) {
                        log.debug('停止播放时出错:', error);
                    }
                }).finally(() => {
                    // quit() 返回时库已断开连接、不再处理事件，不会再按路径连 socket
                    this.removeIpcSocket();
                });
            } catch (error) {
                if (this.config.debug) {
                    log.debug('停止播放异常:', error);
                }
            }

            // 手动触发退出事件
            this.handleExit(0);
        } else {
            // 如果实例已经不存在，也要清理播放列表文件和当前播放项 GUID
            this.cleanupPlaylistFile();
        }
    }

    /**
     * 检查是否正在播放
     */
    isPlaying(): boolean {
        return this.mpvInstance !== null && this.mpvInstance.isRunning();
    }
}
