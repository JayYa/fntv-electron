// 夸克直连：先取文件元信息，再按 MPV 请求的区间向直链取最多 10MiB，流式返回。
// 与 Go 的 ChunkedProxy 一致的地方：从 MPV 请求的起点取、同一请求内按顺序取，不按分片对齐，没有并发上限和预取。
import * as http from 'node:http';
import * as https from 'node:https';
import { once } from 'node:events';
import { pipeline } from 'node:stream';
import type { TtlCache } from '../fn_api/core/ttlCache';
import { ForwardTarget, passthroughHeaders, responseHeaders } from './forward';
import type { ProxyLog } from './log';
import { sendJson } from './respond';

// 单次最多取 10MiB。
const CHUNK_SIZE = 10 * 1024 * 1024;

export interface FileMeta {
    size: number;
    contentType: string;
}

export interface QuarkDeps {
    // 键是流信息给的原始直链 URL（整串，含 userinfo 和 query），与 Go 一致；只缓存成功结果。
    metaCache: TtlCache<FileMeta>;
    // 上游连接多久没有收发数据就断开（毫秒）。
    idleTimeoutMs: number;
    log: ProxyLog;
}

function sendUpstream(
    target: ForwardTarget,
    headers: Record<string, string>,
    idleTimeoutMs: number,
    signal: AbortSignal,
): Promise<http.IncomingMessage> {
    const url = new URL(target.url);
    const isHttps = url.protocol === 'https:';
    const options: https.RequestOptions = {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers,
        agent: false,
        signal,
    };
    if (isHttps) {
        options.rejectUnauthorized = !target.skipVerify;
        options.ca = target.ca;
    }
    return new Promise((resolve, reject) => {
        const request = (isHttps ? https : http).request(options);
        // 空闲超时代替 Go 的 60 秒总超时（U-06，不照搬 Go）：收响应头和 body 期间都算，低速但持续有数据时不会断。
        request.setTimeout(idleTimeoutMs, () => request.destroy(new Error('上游空闲超时')));
        request.on('response', resolve);
        request.on('error', reject);
        request.end();
    });
}

async function fileMeta(target: ForwardTarget, headers: Record<string, string>, idleTimeoutMs: number, signal: AbortSignal): Promise<FileMeta> {
    const response = await sendUpstream(target, { ...headers, range: 'bytes=0-0' }, idleTimeoutMs, signal);
    response.resume();
    const parts = String(response.headers['content-range'] ?? '').split('/');
    if (response.statusCode !== 206 || parts.length !== 2 || !/^[+-]?\d+$/.test(parts[1])) {
        throw new Error(`unexpected meta response: ${response.statusCode}`);
    }
    return { size: Number(parts[1]), contentType: response.headers['content-type'] || 'application/octet-stream' };
}

// 与 Go 的 parseRange 一致：没有 Range 按 0- 处理；只认 bytes=<start>-[<end>]。
function parseRange(header: string | undefined): { start: number, end?: number } | undefined {
    if (!header) return { start: 0 };
    if (!header.startsWith('bytes=')) return undefined;
    const parts = header.slice('bytes='.length).split('-');
    if (parts.length !== 2 || !/^[+-]?\d+$/.test(parts[0])) return undefined;
    if (parts[1] !== '' && !/^[+-]?\d+$/.test(parts[1])) return undefined;
    return { start: Number(parts[0]), end: parts[1] === '' ? undefined : Number(parts[1]) };
}

export async function forwardQuark(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    target: ForwardTarget,
    // 元信息的缓存键：流信息里的原始直链。target.url 已去掉 userinfo，不能当键。
    metaKey: string,
    deps: QuarkDeps,
): Promise<void> {
    const controller = new AbortController();
    res.on('close', () => {
        if (!res.writableFinished) controller.abort();
    });
    // 只发白名单头加直链的 UA、Cookie 和认证，没有 X-Forwarded-For，与 Go 版一致。
    const headers: Record<string, string> = { ...passthroughHeaders(req), ...target.headers };

    let meta = deps.metaCache.get(metaKey);
    if (!meta) {
        try {
            meta = await fileMeta(target, headers, deps.idleTimeoutMs, controller.signal);
        } catch (error: any) {
            if (controller.signal.aborted) return;
            deps.log.error(`获取夸克文件信息失败: ${error?.code ?? error?.name ?? ''}`);
            sendJson(res, 500, { error: 'failed to get meta' });
            return;
        }
        deps.metaCache.set(metaKey, meta);
    }

    // Range 不合法或起点超出文件时，与 Go 版的 416 一致（先取了元信息才知道总大小）。
    const range = parseRange(headers.range);
    if (!range || range.start >= meta.size) {
        deps.log.warn(`夸克 Range 无效: ${headers.range ?? ''}`);
        sendJson(res, 416, { error: 'Range not satisfiable' }, { 'Content-Range': `bytes */${meta.size}` });
        return;
    }
    const start = range.start;
    // 返回 MPV 请求的区间，单次最多 10MiB（U-01，不照搬 Go）。终点小于起点时不理会终点，与 Go 版一致。
    const requestedEnd = range.end !== undefined && range.end >= start ? range.end : Infinity;
    const end = Math.min(requestedEnd, start + CHUNK_SIZE - 1, meta.size - 1);

    deps.log.info(`夸克分片 range=${start}-${end} total=${meta.size}`);
    let upstream: http.IncomingMessage;
    try {
        upstream = await sendUpstream(target, { ...headers, range: `bytes=${start}-${end}` }, deps.idleTimeoutMs, controller.signal);
    } catch (error: any) {
        if (controller.signal.aborted) return;
        deps.log.error(`夸克上游不可用: ${error?.code ?? error?.name ?? ''}`);
        sendJson(res, 502, { error: 'upstream unavailable' });
        return;
    }

    const done = (error: Error | null) => {
        if (error && !controller.signal.aborted) deps.log.debug(`转发中断: ${(error as any).code ?? ''}`);
    };
    const length = end - start + 1;
    if (upstream.statusCode === 206) {
        // 去掉逐跳头和 Set-Cookie（U-14，不照搬 Go）。
        const responseHeadersForMpv = responseHeaders(upstream);
        delete responseHeadersForMpv['set-cookie'];
        res.writeHead(206, responseHeadersForMpv);
        res.flushHeaders();
        pipeline(upstream, res, done);
        return;
    }
    if (upstream.statusCode === 200) {
        // 网盘忽略了 Range，body 从文件第 0 字节开始：跳过起点之前的字节（U-03，不照搬 Go）。
        res.writeHead(206, {
            'Content-Type': upstream.headers['content-type'] || 'application/octet-stream',
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${start}-${end}/${meta.size}`,
            'Content-Length': length,
        });
        res.flushHeaders();
        copySlice(upstream, res, start, length, controller.signal).catch((error) => {
            done(error);
            res.destroy();
        });
        return;
    }
    // 其它状态码：原状态码、Content-Type 和 body 返回，不重试，与 Go 版一致。
    deps.log.warn(`夸克上游状态异常: ${upstream.statusCode}`);
    let body: Buffer;
    try {
        body = await readAll(upstream);
    } catch {
        res.destroy();
        return;
    }
    const contentType = upstream.headers['content-type'];
    res.writeHead(upstream.statusCode ?? 502, {
        ...(contentType ? { 'Content-Type': contentType } : {}),
        'Content-Length': body.length,
    });
    res.end(body);
}

// 只写第 skip 字节起的 length 字节；取够后结束响应，跳出循环时上游随之销毁。
async function copySlice(
    upstream: http.IncomingMessage,
    res: http.ServerResponse,
    skip: number,
    length: number,
    signal: AbortSignal,
): Promise<void> {
    let offset = 0;
    let sent = 0;
    for await (const chunk of upstream as AsyncIterable<Buffer>) {
        const from = Math.max(0, skip - offset);
        offset += chunk.length;
        if (from >= chunk.length) continue;
        const piece = chunk.subarray(from, from + length - sent);
        sent += piece.length;
        if (!res.write(piece)) await once(res, 'drain', { signal });
        if (sent >= length) break;
    }
    // 上游提前结束时 MPV 拿不到足够的字节，断开连接让它知道。
    if (sent < length) res.destroy();
    else res.end();
}

function readAll(stream: http.IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
}
