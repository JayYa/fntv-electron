// 115 的直链直连：用流信息给的 UA（cloudDirectTarget 的通用规则），转发前按限流间隔排队，避免被 115 拒绝。
import type * as http from 'node:http';
import { forward, ForwardTarget } from './forward';
import type { ProxyLog } from './log';

export const CLOUD_TYPE_115 = 3;

// 与 Go 的 rate.NewLimiter(1/间隔, 1) 一致：进程内全局，所有会话和所有 115 文件共用（U-08）。
// 第一个请求不等；之后每个请求距上一次放行至少隔一个间隔，并发请求依次排队。
export class RateLimiter {
    private nextAt = 0;

    constructor(private readonly intervalMs: number) {}

    // 调用时就占下放行时刻，调用方中途放弃也不归还（U-19，与 Go 一致）。
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
            // 定时器可能比 Date.now 早 1 毫秒触发，没到时刻就再等一轮。
            if (remaining <= 0) resolve();
            else setTimeout(check, remaining);
        };
        check();
    });
}

// 每个 MPV 请求只等一次，在 NAS 调用之后、转发之前；416 的重试在 forward 里，不再等。
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
    // MPV 等待中断开时不发上游，与 Go 等完后用已取消的 context 发请求、立即失败一致（U-19）。
    if (dropped) return;
    await forward(req, res, target, log);
}
