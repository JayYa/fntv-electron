import { handleControlRequest, ProxyMessage } from './control';
import { startProxyService } from './index';
import { ipcLog } from './log';

const RATE_LIMIT_INTERVAL_MS = 1000;

const parentPort = process.parentPort;

function post(message: ProxyMessage): void {
    parentPort.postMessage(message);
}

const log = ipcLog(post);

startProxyService({ port: 0, rateLimitIntervalMs: RATE_LIMIT_INTERVAL_MS, log }).then((service) => {
    parentPort.on('message', (event) => post(handleControlRequest(service, event.data)));
    post({ type: 'ready', port: service.port });
}, (error: NodeJS.ErrnoException) => {
    post({ type: 'startFailed', code: error.code ?? '', message: error.message });
});
