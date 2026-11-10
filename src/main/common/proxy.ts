// Proxy 子进程的生命周期：用 utilityProcess 启动，等它回报就绪，意外退出时重启（ADR-0004、docs/external-runtime.md）。
// 视频流量只在 Proxy 子进程和 MPV 之间，不经过主进程。
import { app, dialog, utilityProcess, UtilityProcess } from 'electron';
import * as path from 'node:path';
import * as log from '../../modules/logger';
import { ProxyMessage } from '../../modules/proxy_service/control';
import { writeProxyLog } from '../../modules/proxy_service/log';
import { removeLegacyProxySecret } from './legacyProxySecret';
import { PlaybackSessionInput, ProxyControlClient, ProxyPlaybackSession } from './proxySession';

// 编译后在 dest/modules/proxy_service/child.js，打包后在 app.asar 里的同一位置。
const CHILD_ENTRY = path.join(__dirname, '..', '..', 'modules', 'proxy_service', 'child.js');
const READY_TIMEOUT_MS = 10000;
const RESTART_DELAY_MS = 3000;
const MAX_RESTART_ATTEMPTS = 5;
// 重启后连续运行这么久，重启次数清零。
const RESTART_COUNT_RESET_MS = 60000;
const SHUTDOWN_TIMEOUT_MS = 5000;

interface RunningProxy {
    child: UtilityProcess;
    control: ProxyControlClient;
    // Proxy 就绪时报告的实际端口，每次启动都可能不同。
    port: number;
}

let running: RunningProxy | null = null;
let stopping = false;
let restartAttempts = 0;
let restartCountResetTimer: NodeJS.Timeout | null = null;

function launch(): Promise<RunningProxy> {
    return new Promise((resolve, reject) => {
        const child = utilityProcess.fork(CHILD_ENTRY, [], { serviceName: 'fntv Proxy', stdio: 'pipe' });
        const control = new ProxyControlClient((message) => child.postMessage(message));
        let ready = false;
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error(`Proxy 在 ${READY_TIMEOUT_MS / 1000} 秒内没有就绪`));
        }, READY_TIMEOUT_MS);

        // 子进程自己的输出只有未捕获异常这类情况，日志走 IPC。
        child.stdout?.on('data', (data: Buffer) => log.info('[Proxy] stdout:', data.toString('utf8')));
        child.stderr?.on('data', (data: Buffer) => log.error('[Proxy] stderr:', data.toString('utf8')));
        child.on('message', (message: ProxyMessage) => {
            switch (message.type) {
                case 'log':
                    writeProxyLog(log, message);
                    break;
                case 'ready':
                    ready = true;
                    clearTimeout(timer);
                    resolve({ child, control, port: message.port });
                    break;
                case 'startFailed':
                    clearTimeout(timer);
                    child.kill();
                    reject(new Error(`Proxy 启动失败: ${message.code ? `${message.code} ` : ''}${message.message}`));
                    break;
                default:
                    control.receive(message);
            }
        });
        child.once('exit', (code) => {
            clearTimeout(timer);
            control.close(new Error(`Proxy 已退出 (code=${code})`));
            if (!ready) {
                reject(new Error(`Proxy 在就绪前退出 (code=${code})`));
                return;
            }
            if (running?.child !== child) return;
            running = null;
            if (stopping) return;
            log.warn(`Proxy 意外退出 (code=${code})`);
            void restartAfterCrash();
        });
    });
}

async function startOnce(): Promise<void> {
    running = await launch();
    // 冒烟测试按原文解析这一行拿实际端口（tests/smoke/installer.smoke.cjs 的 PROXY_READY_PATTERN），改措辞要同步改那边。
    log.info(`Proxy 已就绪，端口 ${running.port}`);
    if (restartCountResetTimer) clearTimeout(restartCountResetTimer);
    restartCountResetTimer = setTimeout(() => { restartAttempts = 0; }, RESTART_COUNT_RESET_MS);
}

// Proxy 起不来时应用无法继续：弹窗说明，用户关掉弹窗后退出。
async function showErrorAndQuit(title: string, message: string): Promise<void> {
    try {
        await dialog.showMessageBox({ type: 'error', title, message, buttons: ['退出应用'] });
    } finally {
        app.quit();
    }
}

async function restartAfterCrash(): Promise<void> {
    if (restartCountResetTimer) clearTimeout(restartCountResetTimer);
    while (restartAttempts < MAX_RESTART_ATTEMPTS) {
        restartAttempts++;
        await new Promise(resolve => setTimeout(resolve, RESTART_DELAY_MS));
        if (stopping) return;
        try {
            log.info(`尝试重启 Proxy (第 ${restartAttempts} 次)`);
            await startOnce();
            return;
        } catch (error) {
            log.error(`Proxy 重启失败 (第 ${restartAttempts} 次):`, error instanceof Error ? error.message : String(error));
        }
    }
    log.error(`Proxy 重启 ${MAX_RESTART_ATTEMPTS} 次都失败，应用即将退出`);
    await showErrorAndQuit('应用即将退出', '飞牛影视的播放服务（Proxy）多次启动失败，无法继续运行。');
}

// 启动时调用一次。失败时弹窗说明并退出应用，同时抛出错误，调用方不再继续启动。
export async function startProxyProcess(): Promise<void> {
    removeLegacyProxySecret(app.getPath('userData'), log);
    try {
        await startOnce();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('启动 Proxy 失败:', message);
        await showErrorAndQuit('启动失败', `飞牛影视的播放服务（Proxy）无法启动。\n\n错误详情: ${message}\n\n请查看应用日志获取更多信息。`);
        throw error;
    }
}

// Proxy 就绪前（包括崩溃后重启期间）调用会失败，不等待。
export async function createPlaybackSession(input: PlaybackSessionInput): Promise<ProxyPlaybackSession> {
    const current = running;
    if (!current) throw new Error('Proxy 未运行');
    const session = await current.control.createPlaybackSession(input);
    return { session, port: current.port };
}

// 应用退出前调用。
export async function shutdownProxyProcess(): Promise<void> {
    stopping = true;
    if (restartCountResetTimer) clearTimeout(restartCountResetTimer);
    const current = running;
    running = null;
    if (!current) return;
    await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS);
        current.child.once('exit', () => {
            clearTimeout(timer);
            resolve();
        });
        current.child.kill();
    });
}
