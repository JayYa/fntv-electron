import { app, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { registerHandler } from '../core/ipcHandler';
import * as log from '../../../modules/logger';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const writers: Record<LogLevel, (message: string, ...args: any[]) => void> = {
    debug: log.debug,
    info: log.info,
    warn: log.warn,
    error: log.error,
};

function handleLogMessage(event: IpcMainInvokeEvent, level: LogLevel, ...args: any[]): void {
    const write = Object.hasOwn(writers, level) ? writers[level] : log.info;
    try {
        write('[Renderer]', ...args);
    } catch (error) {
        console.error('渲染进程日志写不进日志器:', level, ...args, error);
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
