import { utilityProcess } from 'electron';
import * as path from 'node:path';
import * as log from '../../modules/logger';
import * as preferences from '../../modules/fn_config/preferences';
import { CreatePlaybackSessionRequest, PROXY_HOST, ProxyMessage } from '../../modules/proxy_service/control';
import { writeProxyLog } from '../../modules/proxy_service/log';
import type { PlaybackUrl } from '../../modules/playback/play';
import type { CurrentConnection } from './currentLogin';
import { ProxyControlClient } from './proxyControlClient';

const CHILD_ENTRY = path.join(__dirname, '..', '..', 'modules', 'proxy_service', 'child.js');
const READY_TIMEOUT_MS = 10000;
const RESTART_DELAY_MS = 3000;
const MAX_RESTART_ATTEMPTS = 5;
const RESTART_COUNT_RESET_MS = 60000;
const SHUTDOWN_TIMEOUT_MS = 5000;

interface ChildOutput {
    on(event: 'data', listener: (data: Buffer) => void): unknown;
}

export interface ProxyChild {
    readonly stdout?: ChildOutput | null;
    readonly stderr?: ChildOutput | null;
    postMessage(message: CreatePlaybackSessionRequest): void;
    on(event: 'message', listener: (message: ProxyMessage) => void): unknown;
    once(event: 'exit', listener: (code: number) => void): unknown;
    kill(): boolean;
}

export interface ProxyDeps {
    fork(): ProxyChild;
    useNasLocal(): boolean;
}

export interface ProxyStartOptions {
    onUnrecoverable(error: Error): void;
}

export interface Proxy {
    start(options: ProxyStartOptions): Promise<void>;
    openPlaybackSession(connection: CurrentConnection, itemGuids: string[]): Promise<PlaybackUrl>;
    shutdown(): Promise<void>;
}

interface RunningProxy {
    child: ProxyChild;
    control: ProxyControlClient;
    port: number;
}

function playbackUrl(port: number, session: string): PlaybackUrl {
    return (itemGuid, sourceIndex = 0) => {
        const query = new URLSearchParams({ session });
        if (sourceIndex > 0) query.set('sourceIndex', String(sourceIndex));
        return `http://${PROXY_HOST}:${port}/api/v1/playvideo/${encodeURIComponent(itemGuid)}?${query}`;
    };
}

export function createProxy(deps: ProxyDeps): Proxy {
    let running: RunningProxy | null = null;
    let stopping = false;
    let restartAttempts = 0;
    let restartCountResetTimer: NodeJS.Timeout | null = null;
    let onUnrecoverable: ProxyStartOptions['onUnrecoverable'] = () => {};

    function launch(): Promise<RunningProxy> {
        return new Promise((resolve, reject) => {
            const child = deps.fork();
            const control = new ProxyControlClient((message) => child.postMessage(message));
            let ready = false;
            const timer = setTimeout(() => {
                child.kill();
                reject(new Error(`Proxy 在 ${READY_TIMEOUT_MS / 1000} 秒内没有就绪`));
            }, READY_TIMEOUT_MS);

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
        log.info(`Proxy 已就绪，端口 ${running.port}`);
        if (restartCountResetTimer) clearTimeout(restartCountResetTimer);
        restartCountResetTimer = setTimeout(() => { restartAttempts = 0; }, RESTART_COUNT_RESET_MS);
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
        onUnrecoverable(new Error(`Proxy 重启 ${MAX_RESTART_ATTEMPTS} 次都失败`));
    }

    return {
        async start(options) {
            onUnrecoverable = options.onUnrecoverable;
            await startOnce();
        },

        async openPlaybackSession(connection, itemGuids) {
            const current = running;
            if (!current) throw new Error('Proxy 未运行');
            const session = await current.control.createPlaybackSession({
                token: connection.token,
                account: connection.account,
                domain: connection.baseUrl,
                accessCookie: connection.accessCookie,
                skipVerify: connection.trustedHost,
                useNasLocal: deps.useNasLocal(),
                itemGuids,
            });
            return playbackUrl(current.port, session);
        },

        async shutdown() {
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
        },
    };
}

export const proxy = createProxy({
    fork: () => utilityProcess.fork(CHILD_ENTRY, [], { serviceName: 'fntv Proxy', stdio: 'pipe' }),
    useNasLocal: () => preferences.get('nasLocalProxy'),
});
