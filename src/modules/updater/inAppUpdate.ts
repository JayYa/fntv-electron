import { app, dialog, shell } from 'electron';
import { autoUpdater, ProgressInfo } from 'electron-updater';
import log from '../logger';
import { isPlaying, stopPlaybackAndWait } from '../playback/playbackState';

/**
 * 应用内更新：更新检查发现新版本、用户点「下载并安装」后，由 electron-updater 下载、校验 sha512 并安装。
 * 不用 electron-updater 判断要不要更新，那是更新检查（updateChecker.ts）的事；这里调它的 checkForUpdates
 * 只是为了读更新源上的 latest.yml，downloadUpdate 要先有这份元数据。
 * 任何一步失败都退回手动更新：弹框提供「打开下载页面」。
 */

type Phase =
    | 'idle'
    | 'downloading'
    | 'downloaded'
    // 用户选了「退出时安装」，还没开始装
    | 'awaitingQuit'
    | 'installing'
    // 正在退出时安装；失败后照常退出
    | 'installingOnQuit';

export interface InAppUpdateOptions {
    /** 更新源地址，每次开始下载时读取，下载加速开关随时生效 */
    feedUrl: () => string;
    /** 失败时「打开下载页面」打开的 Release 页面 */
    releasePageUrl: string;
}

type ProgressListener = (percent: number | null) => void;

/** 应用内更新的下载进度，只读。托盘的「检查更新」项和主窗口的任务栏进度条显示它。 */
export interface DownloadProgress {
    /** 下载中返回 0 到 100 的整数，其它时候是 null */
    percent(): number | null;
    /** 下载进度变化时通知，下载结束（完成或失败）时收到 null */
    onChange(listener: ProgressListener): void;
}

/** 日志里记错误的 message，没有就记错误本身 */
function errorMessage(error: any): unknown {
    return error?.message ?? error;
}

/**
 * 安装前先停止 MPV，并等这次退出的进度回传完成：Windows 上附带的 MPV 在安装目录里，
 * mpv.exe 运行时安装程序覆盖不了它。回传失败由媒体播放插件记日志，不阻止安装。
 */
async function stopPlaybackBeforeInstall(): Promise<void> {
    if (isPlaying()) {
        log.info('应用内更新：安装前停止播放，等进度回传完成');
    }
    try {
        await stopPlaybackAndWait();
    } catch (error: any) {
        log.error('安装前停止播放失败，继续安装:', errorMessage(error));
    }
}

export class InAppUpdate implements DownloadProgress {
    private phase: Phase = 'idle';
    private currentPercent: number | null = null;
    private listeners: ProgressListener[] = [];
    private updaterEventsBound = false;
    private quitHandlerBound = false;

    constructor(private readonly options: InAppUpdateOptions) {}

    percent(): number | null {
        return this.currentPercent;
    }

    onChange(listener: ProgressListener): void {
        this.listeners.push(listener);
    }

    /**
     * 用户点了「下载并安装」。下载在后台进行，这个 Promise 要等下载结束、用户选完安装方式才完成；
     * 调用方不必等它，错误都在这里处理成弹框。下载中再次调用不会开始第二次下载。
     */
    async downloadAndInstall(): Promise<void> {
        switch (this.phase) {
            case 'downloading':
                log.info('应用内更新正在下载，不再开始新的下载');
                return;
            case 'downloaded':
            case 'awaitingQuit':
                await this.askHowToInstall();
                return;
            case 'installing':
            case 'installingOnQuit':
                return;
        }

        this.bindUpdaterEvents();
        this.phase = 'downloading';
        this.setPercent(0);
        try {
            const url = this.options.feedUrl();
            log.info(`应用内更新：从 ${url} 下载`);
            autoUpdater.autoDownload = false;
            // 下载完成那一刻 electron-updater 只在这一项为 true 时注册退出时安装的处理，
            // 所以下载期间先打开，下载完成后立刻关掉，用户选了「退出时安装」再打开。
            autoUpdater.autoInstallOnAppQuit = true;
            // 只下有变化的块；中转不支持 Range 等原因导致差量失败时，electron-updater 自动改下完整安装包
            autoUpdater.disableDifferentialDownload = false;
            autoUpdater.setFeedURL({ provider: 'generic', url });

            const result = await autoUpdater.checkForUpdates();
            if (!result?.isUpdateAvailable) {
                throw new Error('更新源上没有比当前版本新的安装包');
            }
            await autoUpdater.downloadUpdate();
        } catch (error: any) {
            autoUpdater.autoInstallOnAppQuit = false;
            this.phase = 'idle';
            this.setPercent(null);
            log.error('应用内更新下载失败:', errorMessage(error));
            await this.showFailure(error);
            return;
        }

        autoUpdater.autoInstallOnAppQuit = false;
        this.phase = 'downloaded';
        this.setPercent(null);
        log.info('应用内更新下载完成');
        await this.askHowToInstall();
    }

    private async askHowToInstall(): Promise<void> {
        const result = await dialog.showMessageBox({
            type: 'info',
            title: '新版本已下载',
            message: '新版本已下载完成',
            detail: '立即重启安装会关闭客户端，装完后自动重新打开；也可以等下次退出客户端时再安装。',
            buttons: ['立即重启安装', '退出时安装'],
            defaultId: 0,
            cancelId: 1
        });

        if (result.response === 0) {
            log.info('应用内更新：立即重启安装');
            this.phase = 'installing';
            await stopPlaybackBeforeInstall();
            // 静默安装（不显示向导，沿用原安装目录），装完重新启动客户端
            autoUpdater.quitAndInstall(true, true);
        } else {
            log.info('应用内更新：退出时安装');
            autoUpdater.autoInstallOnAppQuit = true;
            this.phase = 'awaitingQuit';
            if (!this.quitHandlerBound) {
                this.quitHandlerBound = true;
                // 排在其它 before-quit 处理前面：拦下退出时，主进程的退出收尾（关 Proxy 等）看到 defaultPrevented 先不做，
                // 免得 MPV 停止前 Proxy 先没了
                app.prependListener('before-quit', event => this.installBeforeQuit(event));
            }
        }
    }

    /**
     * 「退出时安装」生效：先拦下这次退出，停止 MPV、等进度回传完成，再由 quitAndInstall 安装并重新发起退出。
     * electron-updater 自己的退出时安装挂在 quit 事件上，那时 MPV 可能还开着，所以这里抢在它前面装；
     * quitAndInstall 之后 electron-updater 看到安装已经开始，就不会在 quit 时再装一次。
     */
    private installBeforeQuit(event: Electron.Event): void {
        if (this.phase !== 'awaitingQuit') return;
        event.preventDefault();
        this.phase = 'installingOnQuit';
        log.info('应用内更新：客户端退出，开始安装');
        void stopPlaybackBeforeInstall().then(() => {
            // 安装失败时由 error 事件弹框后退出，electron-updater 不必在 quit 时再试一次
            autoUpdater.autoInstallOnAppQuit = false;
            // 静默安装，装完不重新打开客户端：用户要的是退出
            autoUpdater.quitAndInstall(true, false);
        });
    }

    private bindUpdaterEvents(): void {
        if (this.updaterEventsBound) return;
        this.updaterEventsBound = true;

        autoUpdater.logger = log;
        autoUpdater.on('download-progress', (progress: ProgressInfo) => {
            if (this.phase === 'downloading') {
                this.setPercent(Math.floor(progress.percent));
            }
        });
        // 下载阶段的错误同时会让 downloadUpdate 失败，在那里处理；
        // 安装阶段（quitAndInstall 启动安装程序失败）只有这个事件。没有监听时 EventEmitter 会把 error 抛出去。
        autoUpdater.on('error', (error: Error) => {
            if (this.phase !== 'installing' && this.phase !== 'installingOnQuit') return;
            log.error('应用内更新安装失败:', errorMessage(error));
            const quitAfterwards = this.phase === 'installingOnQuit';
            this.phase = 'downloaded';
            this.showFailure(error)
                .catch(dialogError => log.error('显示应用内更新失败提示失败:', dialogError))
                .finally(() => {
                    // 退出时安装失败：用户本来要退出，提示完照常退出
                    if (quitAfterwards) app.quit();
                });
        });
    }

    private setPercent(percent: number | null): void {
        if (percent === this.currentPercent) return;
        this.currentPercent = percent;
        for (const listener of this.listeners) {
            listener(percent);
        }
    }

    private async showFailure(error: any): Promise<void> {
        const reason = error?.message || String(error);
        const result = await dialog.showMessageBox({
            type: 'error',
            title: '应用内更新失败',
            message: '新版本没有装上',
            detail: `${reason}\n\n可以打开下载页面，手动下载安装包更新。`,
            buttons: ['打开下载页面', '确定'],
            defaultId: 0,
            cancelId: 1
        });
        if (result.response === 0) {
            shell.openExternal(this.options.releasePageUrl);
        }
    }
}
