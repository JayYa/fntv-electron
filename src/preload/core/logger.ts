import type { LogLevel } from '../../public/ipcChannels';
import { request } from './ipc';
import type { Logger } from './types';

async function forward(level: LogLevel, fallback: (...args: any[]) => void, args: any[]): Promise<void> {
    try {
        await request('log-message', { level, args });
    } catch {
        fallback(...args);
    }
}

const preloadLogger: Logger = {
    debug: (...args: any[]): void => { void forward('debug', console.debug, args); },
    info: (...args: any[]): void => { void forward('info', console.info, args); },
    warn: (...args: any[]): void => { void forward('warn', console.warn, args); },
    error: (...args: any[]): void => { void forward('error', console.error, args); },
    log: (...args: any[]): void => { void forward('info', console.log, args); },

    d: (...args: any[]): void => preloadLogger.debug(...args),
    i: (...args: any[]): void => preloadLogger.info(...args),
    w: (...args: any[]): void => preloadLogger.warn(...args),
    e: (...args: any[]): void => preloadLogger.error(...args),
};

export default preloadLogger;
