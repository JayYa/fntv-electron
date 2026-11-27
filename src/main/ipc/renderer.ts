import { app, type IpcMainInvokeEvent } from 'electron';
import * as log from '../../modules/logger';
import type { LogLevel } from '../../public/ipcChannels';
import { type ChannelHandlers, InvalidPayload } from './adapter';
import { record } from './parse';

const writers: Record<LogLevel, (message: string, ...args: any[]) => void> = {
    debug: log.debug,
    info: log.info,
    warn: log.warn,
    error: log.error,
};

function parseLogMessage(raw: unknown): { level: LogLevel; args: unknown[] } {
    const { level, args } = record(raw, '日志');
    if (!Array.isArray(args)) throw new InvalidPayload('日志参数不是数组');
    return { level: typeof level === 'string' && Object.hasOwn(writers, level) ? level as LogLevel : 'info', args };
}

function writeLogMessage({ level, args }: { level: LogLevel; args: unknown[] }): void {
    try {
        writers[level]('[Renderer]', ...args);
    } catch (error) {
        // eslint-disable-next-line no-restricted-globals -- 日志器自己抛错，只能写控制台；只写级别和错误，不写未脱敏的参数
        console.error('渲染进程日志写不进日志器:', level, error instanceof Error ? error.message : String(error));
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

function parsePluginNames(raw: unknown): string[] {
    if (!Array.isArray(raw)) throw new InvalidPayload('插件列表不是数组');
    return raw.filter((name): name is string => typeof name === 'string');
}

function logPreloadStarted(plugins: string[], event: IpcMainInvokeEvent): void {
    const pid = event.sender.getOSProcessId();
    log.info('preload 已启动:', {
        page: describePage(event.senderFrame?.url),
        osSandboxed: app.getAppMetrics().find((metric) => metric.pid === pid)?.sandboxed,
        plugins,
    });
}

export const rendererHandlers: Pick<ChannelHandlers, 'log-message' | 'preload-started'> = {
    'log-message': { parse: parseLogMessage, handle: writeLogMessage },
    'preload-started': { parse: parsePluginNames, handle: logPreloadStarted },
};
