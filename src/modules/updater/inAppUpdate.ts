import { app, dialog, shell } from 'electron';
import { autoUpdater, ProgressInfo } from 'electron-updater';
import log from '../logger';
import { isPlaying, stopPlaybackAndWait } from '../playback/playbackState';
import { provideInstallOnQuit, quitForInstall, type ShutdownSignal } from '../quit/quitCoordinator';

type Phase =
    | 'idle'
    | 'downloading'
    | 'downloaded'
    | 'awaitingQuit'
    | 'installing'
    | 'installingOnQuit';

export interface InAppUpdateOptions {
    feedUrl: () => string;
    releasePageUrl: string;
}

type ProgressListener = (percent: number | null) => void;

export interface DownloadProgress {
    percent(): number | null;
    onChange(listener: ProgressListener): void;
}

function errorMessage(error: any): unknown {
    return error?.message ?? error;
}

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

    constructor(private readonly options: InAppUpdateOptions) {}

    percent(): number | null {
        return this.currentPercent;
    }

    onChange(listener: ProgressListener): void {
        this.listeners.push(listener);
    }

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
            autoUpdater.autoInstallOnAppQuit = true;
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
            buttons: ['立即重启安装', '退出时安装', '稍后提醒'],
            defaultId: 0,
            cancelId: 2
        });

        if (result.response === 2) {
            log.info('应用内更新：稍后提醒，暂不安装');
        } else if (result.response === 0) {
            log.info('应用内更新：立即重启安装');
            this.phase = 'installing';
            autoUpdater.autoInstallOnAppQuit = false;
            await stopPlaybackBeforeInstall();
            quitForInstall(() => {
                autoUpdater.quitAndInstall(true, true);
                return this.isInstalling();
            });
        } else {
            log.info('应用内更新：退出时安装');
            autoUpdater.autoInstallOnAppQuit = true;
            this.phase = 'awaitingQuit';
            provideInstallOnQuit({
                pending: () => this.phase === 'awaitingQuit',
                install: () => this.installOnQuit(),
                abandonForShutdown: (signal) => this.abandonInstallOnQuit(signal),
            });
        }
    }

    private isInstalling(): boolean {
        return this.phase === 'installing';
    }

    private installOnQuit(): void {
        this.phase = 'installingOnQuit';
        log.info('应用内更新：客户端退出，开始安装');
        autoUpdater.autoInstallOnAppQuit = false;
        autoUpdater.quitAndInstall(true, false);
    }

    private abandonInstallOnQuit(signal: ShutdownSignal): void {
        if (this.phase !== 'awaitingQuit') return;
        autoUpdater.autoInstallOnAppQuit = false;
        this.phase = 'downloaded';
        log.info(`应用内更新：收到系统关机、重启或注销信号（${signal}），放弃这次退出时安装，下次检查到更新时再装`);
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
        autoUpdater.on('appimage-filename-updated', (newPath: string) => {
            log.info(`应用内更新：AppImage 换了文件名，新文件是 ${newPath}`);
        });
        autoUpdater.on('error', (error: Error) => {
            if (this.phase !== 'installing' && this.phase !== 'installingOnQuit') return;
            log.error('应用内更新安装失败:', errorMessage(error));
            const quitAfterwards = this.phase === 'installingOnQuit';
            this.phase = 'downloaded';
            this.showFailure(error)
                .catch(dialogError => log.error('显示应用内更新失败提示失败:', dialogError))
                .finally(() => {
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
