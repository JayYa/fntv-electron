import { app } from 'electron';
import log from '../logger';
import { stopPlaybackAndWait } from '../playback/playbackState';

/**
 * 退出协调：客户端唯一监听 before-quit 的地方（ESLint 拦截别处注册，eslint.config.mjs）。
 *
 * 用户发起的退出（托盘菜单、菜单栏、app.quit()）先被拦下，按顺序收尾：
 *   1. 停止播放，等这次退出的进度回传完成（stopPlaybackAndWait 自带超时）；
 *   2. 关闭 Proxy，等它关完；
 *   3. 用户选了「退出时安装」就交给应用内更新安装（它发起退出），否则重新发起退出。
 * 第 3 步之后的退出直接放行，这时才调用 onQuit（销毁托盘等），收尾期间托盘图标还在。
 * 「立即重启安装」引发的退出（quitForInstall）也直接放行：拦下会让安装作废。
 * 每一步失败都记日志后继续，客户端不会卡在退不出去。
 */

export interface QuitSteps {
    /** 第 2 步：关闭 Proxy，返回的 Promise 完成才算关完 */
    closeProxy(): Promise<void>;
    /** 退出放行时同步调用：标记正在退出、销毁托盘 */
    onQuit(): void;
}

/** 「退出时安装」，由应用内更新提供 */
export interface InstallOnQuit {
    /** 用户选了「退出时安装」，还没开始装 */
    pending(): boolean;
    /** 开始安装：启动安装程序并重新发起退出；安装失败时提示后自己发起退出 */
    install(): void;
}

type State =
    // 没在退出
    | 'idle'
    // 拦下了退出，正在收尾；这期间再请求退出照样拦下，不重复收尾
    | 'cleaningUp'
    // 收尾完成或正在安装，接下来的退出放行
    | 'releasing';

let steps: QuitSteps | null = null;
let installer: InstallOnQuit | null = null;
let state: State = 'idle';
let quitStartedNotified = false;
let proxyClosing: Promise<void> | null = null;
let released = false;
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

// 两条路径都会关 Proxy（收尾时等它关完，「立即重启安装」放行时不等），只关一次
function closeProxyOnce(current: QuitSteps): Promise<void> {
    proxyClosing ??= runStep('关闭 Proxy', () => current.closeProxy());
    return proxyClosing;
}

// 这次退出要不要安装。只在这里决定，别的退出条件（比如关机时放弃安装）加在这里
function installOnQuitPending(): boolean {
    try {
        return installer?.pending() ?? false;
    } catch (error) {
        log.error('读取退出时安装状态失败，按不安装退出:', error);
        return false;
    }
}

async function cleanUpAndQuit(current: QuitSteps): Promise<void> {
    log.info('客户端退出：停止播放并等进度回传，再关闭 Proxy');
    notifyQuitStarted();
    await runStep('停止播放', stopPlaybackAndWait);
    await closeProxyOnce(current);
    // 收尾期间「立即重启安装」已经接手退出
    if (state !== 'cleaningUp') return;
    state = 'releasing';
    if (installOnQuitPending()) {
        try {
            installer!.install();
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
        current.onQuit();
    } catch (error) {
        log.error('退出收尾「销毁托盘」失败，继续退出:', error);
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

/** 主进程入口启动时调用一次，注册 before-quit。 */
export function initQuitCoordinator(quitSteps: QuitSteps): void {
    if (steps) throw new Error('退出协调已经初始化');
    steps = quitSteps;
    app.on('before-quit', handleBeforeQuit);
}

/**
 * 订阅退出开始：退出收尾的第一步之前同步通知，比停止播放早。返回取消订阅的函数。
 * 推迟到播放结束才弹的更新提示用它作废：退出时停止播放也会让播放结束。
 */
export function onQuitStarted(listener: () => void): () => void {
    startedListeners.add(listener);
    return () => {
        startedListeners.delete(listener);
    };
}

/** 应用内更新提供「退出时安装」，收尾第 3 步问它要不要安装。 */
export function provideInstallOnQuit(installOnQuit: InstallOnQuit): void {
    installer = installOnQuit;
}

/**
 * 「立即重启安装」：调用方已经停了播放，start 调 quitAndInstall，返回安装程序是否已经启动。
 * 启动了的话，它引发的退出直接放行（照常关 Proxy、销毁托盘，不等 Proxy 关完）；
 * 没启动（安装失败）时恢复原状，之后的退出按普通退出处理。
 */
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
