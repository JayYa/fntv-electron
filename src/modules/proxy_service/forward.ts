// 透明转发：把 MPV 的请求转给上游，流式返回响应。
import * as http from 'node:http';
import * as https from 'node:https';
import { pipeline } from 'node:stream';
import type { ProxyLog } from './log';
import { sendJson } from './respond';

// 从 MPV 请求转给上游的头。不在这里的头（Cookie、Authorization 等）不转发（U-05，不照搬 Go）。
const PASSTHROUGH_HEADERS = [
    'user-agent',
    'accept',
    'accept-language',
    'accept-encoding',
    'cache-control',
    'pragma',
    'range',
    'if-range',
    'if-modified-since',
    'if-none-match',
];

// 不能转发的逐跳头，Connection 里列出的头也一样。
const HOP_BY_HOP_HEADERS = new Set([
    'connection',
    'keep-alive',
    'proxy-connection',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
]);

const RESPONSE_HEADER_TIMEOUT_MS = 120 * 1000;

export interface ForwardTarget {
    url: string;
    // 覆盖白名单头，例如 NAS 的 Authorization 和 Cookie。
    headers: Record<string, string>;
    skipVerify: boolean;
    ca: string[];
}

export function passthroughHeaders(req: http.IncomingMessage): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const name of PASSTHROUGH_HEADERS) {
        const value = req.headers[name];
        const text = Array.isArray(value) ? value[0] : value;
        if (text) headers[name] = text;
    }
    return headers;
}

function responseHeaders(upstream: http.IncomingMessage): http.OutgoingHttpHeaders {
    const connectionTokens = new Set(
        String(upstream.headers.connection || '').split(',').map((token) => token.trim().toLowerCase()).filter(Boolean),
    );
    const headers: http.OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(upstream.headers)) {
        if (value === undefined || HOP_BY_HOP_HEADERS.has(name) || connectionTokens.has(name)) continue;
        headers[name] = value;
    }
    return headers;
}

function sendUpstream(
    target: ForwardTarget,
    headers: Record<string, string>,
    method: string,
    signal: AbortSignal,
): Promise<http.IncomingMessage> {
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

    return new Promise((resolve, reject) => {
        const request = (isHttps ? https : http).request(options);
        const timer = setTimeout(() => request.destroy(new Error('等待上游响应头超时')), RESPONSE_HEADER_TIMEOUT_MS);
        request.on('response', (response) => {
            clearTimeout(timer);
            resolve(response);
        });
        request.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        request.end();
    });
}

export async function forward(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    target: ForwardTarget,
    log: ProxyLog,
): Promise<void> {
    const controller = new AbortController();
    // MPV 断开时取消上游请求。
    res.on('close', () => {
        if (!res.writableFinished) controller.abort();
    });

    const headers: Record<string, string> = { ...passthroughHeaders(req), ...target.headers, 'x-forwarded-for': '127.0.0.1' };
    const method = req.method || 'GET';
    const { host, pathname } = new URL(target.url);
    log.info(`代理请求 method=${method} host=${host} path=${pathname} range=${headers.range ?? ''}`);

    let upstream: http.IncomingMessage;
    try {
        upstream = await sendUpstream(target, headers, method, controller.signal);
        // 上游拒绝初始的开放 Range 时，去掉 Range 重试一次，与 Go 版一致。
        if (upstream.statusCode === 416 && headers.range === 'bytes=0-') {
            upstream.resume();
            const retryHeaders = { ...headers };
            delete retryHeaders.range;
            delete retryHeaders['if-range'];
            log.warn(`上游拒绝初始开放 Range，请求将在不带 Range 的情况下重试: ${pathname}`);
            upstream = await sendUpstream(target, retryHeaders, method, controller.signal);
        }
    } catch (error: any) {
        if (controller.signal.aborted) return;
        log.debug(`代理错误: ${error?.code ?? ''}`);
        if (!res.headersSent) {
            // 错误详情只给错误码，不含上游 URL（U-10，不照搬 Go）。
            sendJson(res, 500, { error: 'Proxy error', details: error?.code || 'upstream request failed' });
        }
        return;
    }

    log.info(`代理响应 status=${upstream.statusCode} contentLength=${upstream.headers['content-length'] ?? -1}`);
    res.writeHead(upstream.statusCode || 502, responseHeaders(upstream));
    res.flushHeaders();
    pipeline(upstream, res, (error) => {
        if (error && !controller.signal.aborted) log.debug(`转发中断: ${(error as any).code ?? ''}`);
    });
}
