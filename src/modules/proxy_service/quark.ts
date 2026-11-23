import type * as http from 'node:http';
import { once } from 'node:events';
import { pipeline } from 'node:stream';
import type { TtlCache } from '../fn_api/core/ttlCache';
import { ForwardTarget, passthroughHeaders, responseHeaders } from './forward';
import type { ProxyLog } from './log';
import { abortWhenMpvLeaves, readBody, sendJson } from './respond';
import { openUpstream } from './upstream';

export const CLOUD_TYPE_QUARK = 4;

const CHUNK_SIZE = 10 * 1024 * 1024;

export interface FileMeta {
    size: number;
    contentType: string;
}

export interface QuarkDeps {
    metaCache: TtlCache<FileMeta>;
    idleTimeoutMs: number;
    log: ProxyLog;
}

function sendUpstream(
    target: ForwardTarget,
    headers: Record<string, string>,
    idleTimeoutMs: number,
    signal: AbortSignal,
): Promise<http.IncomingMessage> {
    return new Promise((resolve, reject) => {
        const request = openUpstream(target, headers, 'GET', signal);
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
    metaKey: string,
    deps: QuarkDeps,
): Promise<void> {
    const controller = abortWhenMpvLeaves(res);
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

    const range = parseRange(headers.range);
    if (!range || range.start >= meta.size) {
        deps.log.warn(`夸克 Range 无效: ${headers.range ?? ''}`);
        sendJson(res, 416, { error: 'Range not satisfiable' }, { 'Content-Range': `bytes */${meta.size}` });
        return;
    }
    const start = range.start;
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
        const responseHeadersForMpv = responseHeaders(upstream);
        delete responseHeadersForMpv['set-cookie'];
        res.writeHead(206, responseHeadersForMpv);
        res.flushHeaders();
        pipeline(upstream, res, done);
        return;
    }
    if (upstream.statusCode === 200) {
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
    deps.log.warn(`夸克上游状态异常: ${upstream.statusCode}`);
    let body: Buffer;
    try {
        body = await readBody(upstream);
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
    if (sent < length) res.destroy();
    else res.end();
}
