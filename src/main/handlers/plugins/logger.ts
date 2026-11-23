import { app, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { registerHandler } from '../core/ipcHandler';
import * as log from '../../../modules/logger';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function handleLogMessage(event: IpcMainInvokeEvent, level: LogLevel, ...args: any[]): void {
    try {
        switch (level) {
            case 'debug':
                log.debug('[Renderer]', ...args);
                break;
            case 'info':
                log.info('[Renderer]', ...args);
                break;
            case 'warn':
                log.warn('[Renderer]', ...args);
                break;
            case 'error':
                log.error('[Renderer]', ...args);
                break;
            default:
                log.info('[Renderer]', ...args);
        }
    } catch (error) {
        log.error('日志记录失败:', error);
        log.info('[Renderer]', level, ...args);
    }
}

function describePage(url: string | undefined): string {
    try {
        const { protocol, host } = new URL(url ?? '');
        return `${protocol}//${host}`;
    } catch {
        return 'unknown';
    }
}

function handlePreloadStarted(event: IpcMainEvent, plugins: unknown): void {
    const pid = event.sender.getOSProcessId();
    log.info('preload 已启动:', {
        page: describePage(event.senderFrame?.url),
        osSandboxed: app.getAppMetrics().find((metric) => metric.pid === pid)?.sandboxed,
        plugins: Array.isArray(plugins) ? plugins.filter((name) => typeof name === 'string') : [],
    });
}

function init(): void {
    registerHandler('log-message', handleLogMessage, { useHandle: true });
    registerHandler('preload-started', handlePreloadStarted);
}

export {
    init
};
