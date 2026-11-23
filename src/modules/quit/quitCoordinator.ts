import { app, powerMonitor, type BrowserWindow } from 'electron';
import * as log from '../logger';
import { stopPlaybackAndWait } from '../playback/playbackState';

export interface QuitSteps {
    closeProxy(): Promise<void>;
    onQuitReleased(): void;
}

export interface InstallOnQuit {
    pending(): boolean;
    install(): void;
    abandonForShutdown(signal: ShutdownSignal): void;
}

export type ShutdownSignal = 'Windows session-end' | 'powerMonitor shutdown';

type State =
    | 'idle'
    | 'cleaningUp'
    | 'releasing';

let steps: QuitSteps | null = null;
let installer: InstallOnQuit | null = null;
let state: State = 'idle';
let quitStartedNotified = false;
let proxyClosing: Promise<void> | null = null;
let released = false;
let listeningForShutdown = false;
const startedListeners = new Set<() => void>();

async function runStep(name: string, step: () => unknown): Promise<void> {
    try {
        await step();
    } catch (error) {
        log.error(`退出收尾「${name}」失败，继续退出:`, error);
    }
}

function notifyQuitStarted(): void {
    if (quitStartedNotified) return;
    quitStartedNotified = true;
    for (const listener of [...startedListeners]) {
        try {
            listener();
        } catch (error) {
            log.error('退出开始的通知处理失败，继续退出:', error);
        }
    }
}

function closeProxyOnce(current: QuitSteps): Promise<void> {
    proxyClosing ??= runStep('关闭 Proxy', () => current.closeProxy());
    return proxyClosing;
}

function installerForThisQuit(): InstallOnQuit | null {
    try {
        return installer?.pending() ? installer : null;
    } catch (error) {
        log.error('读取退出时安装状态失败，按不安装退出:', error);
        return null;
    }
}

async function cleanUpAndQuit(current: QuitSteps): Promise<void> {
    log.info('客户端退出：停止播放并等进度回传，再关闭 Proxy');
    notifyQuitStarted();
    await runStep('停止播放', stopPlaybackAndWait);
    await closeProxyOnce(current);
    if (state !== 'cleaningUp') return;
    state = 'releasing';
    const installing = installerForThisQuit();
    if (installing) {
        try {
            installing.install();
            return;
        } catch (error) {
            log.error('退出时安装失败，直接退出:', error);
        }
    }
    app.quit();
}

function release(current: QuitSteps): void {
    if (released) return;
    released = true;
    notifyQuitStarted();
    void closeProxyOnce(current);
    try {
        current.onQuitReleased();
    } catch (error) {
        log.error('退出放行时的收尾失败，继续退出:', error);
    }
}

function handleBeforeQuit(event: Electron.Event): void {
    const current = steps;
    if (!current) return;
    if (state === 'releasing') {
        release(current);
        return;
    }
    event.preventDefault();
    if (state === 'cleaningUp') {
        log.info('客户端正在退出收尾，这次退出请求不再重复收尾');
        return;
    }
    state = 'cleaningUp';
    void cleanUpAndQuit(current);
}

export function isQuitting(): boolean {
    return state !== 'idle' || released;
}

export function initQuitCoordinator(quitSteps: QuitSteps): void {
    if (steps) throw new Error('退出协调已经初始化');
    steps = quitSteps;
    app.on('before-quit', handleBeforeQuit);
}

export function onQuitStarted(listener: () => void): () => void {
    startedListeners.add(listener);
    return () => {
        startedListeners.delete(listener);
    };
}

function abandonInstallForShutdown(signal: ShutdownSignal): void {
    try {
        installer?.abandonForShutdown(signal);
    } catch (error) {
        log.error('系统关机时放弃退出时安装失败:', error);
    }
}

export function listenForSystemShutdown(mainWindow: Pick<BrowserWindow, 'on'>): void {
    if (listeningForShutdown) throw new Error('已经在监听系统关机');
    listeningForShutdown = true;
    mainWindow.on('session-end', () => abandonInstallForShutdown('Windows session-end'));
    powerMonitor.on('shutdown', () => abandonInstallForShutdown('powerMonitor shutdown'));
}

export function provideInstallOnQuit(installOnQuit: InstallOnQuit): void {
    installer = installOnQuit;
}

export function quitForInstall(start: () => boolean): void {
    const previous = state;
    state = 'releasing';
    let started = false;
    try {
        started = start();
    } catch (error) {
        log.error('立即重启安装失败:', error);
    }
    if (!started) state = previous;
}
