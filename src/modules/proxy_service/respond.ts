import type * as http from 'node:http';

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
