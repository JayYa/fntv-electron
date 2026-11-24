import type * as http from 'node:http';
import type { Readable } from 'node:stream';

export function sendJson(res: http.ServerResponse, status: number, body: unknown, headers: http.OutgoingHttpHeaders = {}): void {
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    res.writeHead(status, {
        ...headers,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': payload.length,
    });
    res.end(payload);
}

export function abortWhenMpvLeaves(res: http.ServerResponse): AbortController {
    const controller = new AbortController();
    res.on('close', () => {
        if (!res.writableFinished) controller.abort();
    });
    return controller;
}

export function readBody(stream: Readable): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
}
