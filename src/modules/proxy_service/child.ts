// Proxy 子进程入口，由主进程用 utilityProcess.fork() 启动（src/main/common/proxy.ts）。
// 只把 parentPort 的消息转给 Proxy 服务、回报启动结果和日志，不含业务逻辑。
import { format } from 'node:util';
import { handleControlRequest, PROXY_PORT, ProxyMessage } from './control';
import { startProxyService } from './index';
import type { ProxyLog } from './log';

// 115 两次请求之间的最小间隔。
const RATE_LIMIT_INTERVAL_MS = 1000;

const parentPort = process.parentPort;

function post(message: ProxyMessage): void {
    parentPort.postMessage(message);
}

// 日志交给主进程的 logger 写，脱敏规则和主进程一致。
const level = (name: 'debug' | 'info' | 'warn' | 'error') =>
    (message: string, ...args: unknown[]) => post({ type: 'log', level: name, message: format(message, ...args) });
const log: ProxyLog = { debug: level('debug'), info: level('info'), warn: level('warn'), error: level('error') };

startProxyService({ port: PROXY_PORT, rateLimitIntervalMs: RATE_LIMIT_INTERVAL_MS, log }).then((service) => {
    parentPort.on('message', (event) => post(handleControlRequest(service, event.data)));
    post({ type: 'ready', port: service.port });
}, (error: NodeJS.ErrnoException) => {
    // 主进程收到后结束这个进程。
    post({ type: 'startFailed', code: error.code ?? '', message: error.message });
});
