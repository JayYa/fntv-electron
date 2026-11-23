import type * as http from 'node:http';
import { forward, ForwardTarget } from './forward';
import type { ProxyLog } from './log';

export const CLOUD_TYPE_115 = 3;

export class RateLimiter {
    private nextAt = 0;

    constructor(private readonly intervalMs: number) {}

    wait(): Promise<void> {
        const now = Date.now();
        const at = Math.max(now, this.nextAt);
        this.nextAt = at + this.intervalMs;
        return sleepUntil(at);
    }
}

function sleepUntil(at: number): Promise<void> {
    return new Promise((resolve) => {
        const check = () => {
            const remaining = at - Date.now();
            if (remaining <= 0) resolve();
            else setTimeout(check, remaining);
        };
        check();
    });
}

export async function forward115(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    target: ForwardTarget,
    limiter: RateLimiter,
    log: ProxyLog,
): Promise<void> {
    let dropped = false;
    const onClose = () => {
        dropped = true;
    };
    res.once('close', onClose);
    await limiter.wait();
    res.off('close', onClose);
    if (dropped) return;
    await forward(req, res, target, log);
}
