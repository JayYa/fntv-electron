import type { LogMethod } from '../fn_api/core/request';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type ProxyLog = Record<LogLevel, LogMethod>;

const noop: LogMethod = () => {};

export const silentLog: ProxyLog = { debug: noop, info: noop, warn: noop, error: noop };

export interface ProxyLogMessage {
    type: 'log';
    level: LogLevel;
    message: string;
    args: unknown[];
}

function cloneable(arg: unknown): unknown {
    if (arg instanceof Error) {
        const { code } = arg as NodeJS.ErrnoException;
        return { name: arg.name, message: arg.message, ...(code ? { code } : {}) };
    }
    try {
        return structuredClone(arg);
    } catch {
        return String(arg);
    }
}

export function ipcLog(post: (message: ProxyLogMessage) => void): ProxyLog {
    const level = (name: LogLevel): LogMethod =>
        (message, ...args) => post({ type: 'log', level: name, message, args: args.map(cloneable) });
    return { debug: level('debug'), info: level('info'), warn: level('warn'), error: level('error') };
}

export function writeProxyLog(log: ProxyLog, message: ProxyLogMessage): void {
    log[message.level](`[Proxy] ${message.message}`, ...message.args);
}
