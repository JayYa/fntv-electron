import type * as http from 'node:http';
import type { Readable } from 'node:stream';

// 与 gin 的 c.JSON 相同的响应头。
export function sendJson(res: http.ServerResponse, status: number, body: unknown, headers: http.OutgoingHttpHeaders = {}): void {
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    res.writeHead(status, {
        ...headers,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': payload.length,
    });
    res.end(payload);
}

// MPV 在响应写完之前断开时触发 abort，用来取消上游请求。
export function abortWhenMpvLeaves(res: http.ServerResponse): AbortController {
    const controller = new AbortController();
    res.on('close', () => {
        if (!res.writableFinished) controller.abort();
    });
    return controller;
}

// 读完整个 body。
export function readBody(stream: Readable): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
}
