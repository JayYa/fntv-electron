import { app, dialog, shell } from 'electron';
import { autoUpdater, ProgressInfo } from 'electron-updater';
import log from '../logger';
import { isPlaying, stopPlaybackAndWait } from '../playback/playbackState';
import { provideInstallOnQuit, quitForInstall, type ShutdownSignal } from '../quit/quitCoordinator';

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
 * 「立即重启安装」前先停止 MPV，并等这次退出的进度回传完成（「退出时安装」由退出协调先停）：Windows 上附带的 MPV 在安装目录里，
 * mpv.exe 运行时安装程序覆盖不了它。回传失败由媒体播放插件记日志，不阻止安装；
 * 回传或 MPV 退出迟迟不来时，stopPlaybackAndWait 等到它的超时就返回，之后照常安装。
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
            // 关掉对话框等于「稍后提醒」：什么都不装，下次检查再问（安装要用户点头）
            buttons: ['立即重启安装', '退出时安装', '稍后提醒'],
            defaultId: 0,
            cancelId: 2
        });

        if (result.response === 2) {
            log.info('应用内更新：稍后提醒，暂不安装');
        } else if (result.response === 0) {
            log.info('应用内更新：立即重启安装');
            this.phase = 'installing';
            // 之前选过「退出时安装」时这一项还开着。这次安装失败的话，electron-updater 会在退出时自己再装，
            // 那条路径不先停 MPV，所以关掉；失败后用户可以重新检查再选
            autoUpdater.autoInstallOnAppQuit = false;
            await stopPlaybackBeforeInstall();
            // 静默安装（不显示向导，沿用原安装目录），装完重新启动客户端。
            // 安装程序启动失败时 electron-updater 同步发 error 事件（阶段回到 downloaded），不退出
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

    /**
     * 「退出时安装」生效：退出协调已经停了 MPV、等完进度回传、关了 Proxy，这里由 quitAndInstall 安装并重新发起退出。
     * electron-updater 自己的退出时安装挂在 quit 事件上，那时 MPV 可能还开着，所以抢在它前面装；
     * quitAndInstall 之后 electron-updater 看到安装已经开始，就不会在 quit 时再装一次。
     */
    private installOnQuit(): void {
        this.phase = 'installingOnQuit';
        log.info('应用内更新：客户端退出，开始安装');
        // 安装失败时由 error 事件弹框后退出，electron-updater 不必在 quit 时再试一次
        autoUpdater.autoInstallOnAppQuit = false;
        // 静默安装，装完不重新打开客户端：用户要的是退出
        autoUpdater.quitAndInstall(true, false);
    }

    /**
     * 系统关机、重启或注销时放弃「退出时安装」（维护者决定不在关机时尽力安装，#192）。
     * 回到「已下载、未选安装方式」，下次点「下载并安装」时 electron-updater 复用已下载的安装包。
     * 安装已经开始（quitAndInstall 已调用）或没选「退出时安装」时什么都不做。
     */
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
        // Linux：electron-updater 安装时先删掉旧 AppImage。旧文件名里有 x.y.z 三段数字时，新文件用新版本的文件名，
        // 指向旧文件名的快捷方式会失效，并发这个事件；没有时用原文件名，不发。用户该怎么做见 README 的 Linux 安装说明
        autoUpdater.on('appimage-filename-updated', (newPath: string) => {
            log.info(`应用内更新：AppImage 换了文件名，新文件是 ${newPath}`);
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
