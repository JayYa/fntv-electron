// Proxy 的日志由调用方传入。这一层不加载 logger，以免间接加载 electron。
import type { LogMethod } from '../fn_api/core/request';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type ProxyLog = Record<LogLevel, LogMethod>;

const noop: LogMethod = () => {};

export const silentLog: ProxyLog = { debug: noop, info: noop, warn: noop, error: noop };

// Proxy → 主进程的一条日志。
export interface ProxyLogMessage {
    type: 'log';
    level: LogLevel;
    message: string;
    args: unknown[];
}

// 参数要经结构化克隆发出。Error 换成带 name、message、code 的普通对象，克隆不了的（函数等）转成字符串。
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

// Proxy 子进程用：每条日志交给 post 发给主进程。参数不在这里拼成字符串，由主进程的 logger 格式化，按字段名脱敏才能生效。
export function ipcLog(post: (message: ProxyLogMessage) => void): ProxyLog {
    const level = (name: LogLevel): LogMethod =>
        (message, ...args) => post({ type: 'log', level: name, message, args: args.map(cloneable) });
    return { debug: level('debug'), info: level('info'), warn: level('warn'), error: level('error') };
}

// 主进程用：交给主进程的 logger 写。
export function writeProxyLog(log: ProxyLog, message: ProxyLogMessage): void {
    log[message.level](`[Proxy] ${message.message}`, ...message.args);
}
