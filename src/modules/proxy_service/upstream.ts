// 向上游（NAS 或网盘直链）发请求。透明转发和夸克共用，超时由调用方各自设置。
import * as http from 'node:http';
import * as https from 'node:https';
import type { ForwardTarget } from './forward';

// 返回还没 end() 的请求，调用方设好超时和事件后再 end()。
export function openUpstream(
    target: ForwardTarget,
    headers: Record<string, string>,
    method: string,
    signal: AbortSignal,
): http.ClientRequest {
    const url = new URL(target.url);
    const isHttps = url.protocol === 'https:';
    const options: https.RequestOptions = {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        // 每个请求单独建连接，与 Go 版一致。
        agent: false,
        signal,
    };
    if (isHttps) {
        options.rejectUnauthorized = !target.skipVerify;
        options.ca = target.ca;
    }
    return (isHttps ? https : http).request(options);
}
