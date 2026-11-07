import { app, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { registerHandler } from '../core/ipcHandler';
import * as log from '../../../modules/logger';

/**
 * 日志管理插件
 * 处理渲染进程的日志消息
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// 处理渲染进程日志消息
function handleLogMessage(event: IpcMainInvokeEvent, level: LogLevel, ...args: any[]): void {
    try {
        // 根据级别调用对应的日志方法
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
        // 如果日志记录失败，至少在控制台输出
        log.error('日志记录失败:', error);
        log.info('[Renderer]', level, ...args);
    }
}

// 只留协议和主机，路径和查询串可能带 token。
function describePage(url: string | undefined): string {
    try {
        const { protocol, host } = new URL(url ?? '');
        return `${protocol}//${host}`;
    } catch {
        return 'unknown';
    }
}

// 手工冒烟靠这条判断沙箱和插件。osSandboxed 是系统层面的实际状态，Electron 只在 Windows 和 macOS 上提供。
function handlePreloadStarted(event: IpcMainEvent, plugins: unknown): void {
    const pid = event.sender.getOSProcessId();
    log.info('preload 已启动:', {
        page: describePage(event.senderFrame?.url),
        osSandboxed: app.getAppMetrics().find((metric) => metric.pid === pid)?.sandboxed,
        plugins: Array.isArray(plugins) ? plugins.filter((name) => typeof name === 'string') : [],
    });
}

// 注册日志相关处理器
function init(): void {
    registerHandler('log-message', handleLogMessage, { useHandle: true });
    registerHandler('preload-started', handlePreloadStarted);
}

export {
    init
};
