// preload/logger.ts - 渲染进程日志接口
import { ipcRenderer } from 'electron';
import type { Logger } from './types';

// invoke 的失败是异步的，要 await 才能回退到 console。
async function forward(level: string, fallback: (...args: any[]) => void, args: any[]): Promise<void> {
    try {
        await ipcRenderer.invoke('log-message', level, ...args);
    } catch {
        fallback(...args);
    }
}

/**
 * 渲染进程日志模块
 * 通过IPC将日志发送到主进程进行处理
 * 主进程会自动进行数据脱敏，对渲染进程完全透明
 */
const preloadLogger: Logger = {
    debug: (...args: any[]): void => { void forward('debug', console.debug, args); },
    info: (...args: any[]): void => { void forward('info', console.info, args); },
    warn: (...args: any[]): void => { void forward('warn', console.warn, args); },
    error: (...args: any[]): void => { void forward('error', console.error, args); },
    log: (...args: any[]): void => { void forward('info', console.log, args); },

    // 方便的方法别名
    d: (...args: any[]): void => preloadLogger.debug(...args),   // debug简写
    i: (...args: any[]): void => preloadLogger.info(...args),    // info简写
    w: (...args: any[]): void => preloadLogger.warn(...args),    // warn简写
    e: (...args: any[]): void => preloadLogger.error(...args),   // error简写
};

export default preloadLogger;
