import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { TtlCache } from '../fn_api/core/ttlCache';
import { trustedCaCertificates } from './caCertificates';
import { RateLimiter } from './cloud115';
import { PROXY_HOST } from './control';
import { ProxyLog, silentLog } from './log';
import { PlaybackSessionInput, PlaybackSessionStore } from './playbackSessions';
import { handlePlayVideo, PlayVideoDeps } from './playvideo';
import { sendJson } from './respond';
import { handleGetSkipInfo, handleSetSkipInfo } from './skipinfo';

export type { PlaybackSessionInput } from './playbackSessions';
export type { ProxyLog } from './log';

export interface ProxyServiceOptions {
    port: number;
    rateLimitIntervalMs: number;
    quarkIdleTimeoutMs?: number;
    log?: ProxyLog;
}

export interface ProxyService {
    port: number;
    createPlaybackSession(input: PlaybackSessionInput): string;
    close(): Promise<void>;
}

type RouteHandler = (req: http.IncomingMessage, res: http.ServerResponse, params: string[], query: URLSearchParams) => Promise<void>;

interface Route {
    method: string;
    segments: string[];
    handler: RouteHandler;
}

function matchRoute(routes: Route[], method: string, segments: string[]): { route: Route, params: string[] } | undefined {
    for (const route of routes) {
        if (route.method !== method || route.segments.length !== segments.length) continue;
        const params: string[] = [];
        const matched = route.segments.every((expected, index) => {
            const actual = segments[index];
            if (expected.startsWith(':')) {
                params.push(actual);
                return actual !== '';
            }
            return expected === actual;
        });
        if (matched) return { route, params };
    }
    return undefined;
}

function splitPath(pathname: string): string[] | undefined {
    try {
        return pathname.split('/').slice(1).map((segment) => decodeURIComponent(segment));
    } catch {
        return undefined;
    }
}

export function startProxyService(options: ProxyServiceOptions): Promise<ProxyService> {
    const log = options.log ?? silentLog;
    const sessions = new PlaybackSessionStore();
    const deps: PlayVideoDeps = {
        sessions,
        cache: new TtlCache({ defaultTtl: 300 }),
        ca: trustedCaCertificates(),
        log,
        limiter115: new RateLimiter(options.rateLimitIntervalMs),
        quarkMetaCache: new TtlCache({ defaultTtl: 200 * 60 }),
        quarkIdleTimeoutMs: options.quarkIdleTimeoutMs ?? 60 * 1000,
    };
    const routes: Route[] = [
        {
            method: 'GET',
            segments: ['api', 'v1', 'playvideo', ':itemGuid'],
            handler: (req, res, [itemGuid], query) => handlePlayVideo(req, res, itemGuid, query, deps),
        },
        {
            method: 'GET',
            segments: ['api', 'v1', 'skipinfo', ':itemGuid'],
            handler: (_req, res, [itemGuid], query) => handleGetSkipInfo(res, itemGuid, query, deps),
        },
        {
            method: 'POST',
            segments: ['api', 'v1', 'skipinfo'],
            handler: (req, res, _params, query) => handleSetSkipInfo(req, res, query, deps),
        },
    ];

    const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const method = req.method || 'GET';
        const segments = splitPath(url.pathname);
        if (!segments) {
            sendJson(res, 400, { error: 'Invalid parameters' });
            return;
        }
        const matched = matchRoute(routes, method, segments);
        if (matched) {
            matched.route.handler(req, res, matched.params, url.searchParams).catch((error) => {
                log.error(`处理请求失败: ${error?.code ?? error?.name ?? ''}`);
                if (res.headersSent) {
                    res.destroy();
                    return;
                }
                res.writeHead(500);
                res.end();
            });
            return;
        }
        if (url.pathname.length > 1 && url.pathname.endsWith('/') && matchRoute(routes, method, segments.slice(0, -1))) {
            res.writeHead(method === 'GET' ? 301 : 307, { Location: `${url.pathname.slice(0, -1)}${url.search}` });
            res.end();
            return;
        }
        log.warn(`收到404请求: ${method} ${url.pathname}`);
        sendJson(res, 404, { error: 'Not Found' });
    });
    server.requestTimeout = 0;
    server.headersTimeout = 0;
    server.timeout = 0;

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port, PROXY_HOST, () => {
            server.off('error', reject);
            resolve({
                port: (server.address() as AddressInfo).port,
                createPlaybackSession: (input) => sessions.create(input),
                close: () => new Promise((done) => {
                    server.closeAllConnections();
                    server.close(() => done());
                }),
            });
        });
    });
}
