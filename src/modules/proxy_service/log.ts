// Proxy 的日志由调用方传入。这一层不加载 logger，以免间接加载 electron。
type LogMethod = (message: string, ...args: any[]) => void;

export interface ProxyLog {
    debug: LogMethod;
    info: LogMethod;
    warn: LogMethod;
    error: LogMethod;
}

const noop: LogMethod = () => {};

export const silentLog: ProxyLog = { debug: noop, info: noop, warn: noop, error: noop };
