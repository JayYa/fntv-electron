// Proxy 服务：MPV 通过它取视频流。由 Proxy 子进程启动，测试在进程内启动。
// 只依赖 fn_api/core，不引用 electron 和 logger（eslint.config.mjs）。
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

// 只监听本机。正式运行时端口为 PROXY_PORT，限流间隔为 1 秒（child.ts）。

export interface ProxyServiceOptions {
    // 监听端口，传 0 时由系统分配。
    port: number;
    // 115 两次请求之间的最小间隔（毫秒）。
    rateLimitIntervalMs: number;
    // 夸克上游连接的空闲超时（毫秒），默认 60 秒。
    quarkIdleTimeoutMs?: number;
    log?: ProxyLog;
}

export interface ProxyService {
    // 实际监听的端口。
    port: number;
    // 创建播放会话，返回 64 位十六进制的会话 ID；入参不合法时抛错。
    createPlaybackSession(input: PlaybackSessionInput): string;
    close(): Promise<void>;
}

type RouteHandler = (req: http.IncomingMessage, res: http.ServerResponse, params: string[], query: URLSearchParams) => Promise<void>;

interface Route {
    method: string;
    // 以 : 开头的段是路径参数，不能为空。
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
        // NAS 调用的缓存，所有会话共用；同一台 NAS、同一个 token 命中同一份。
        cache: new TtlCache({ defaultTtl: 300 }),
        ca: trustedCaCertificates(),
        log,
        limiter115: new RateLimiter(options.rateLimitIntervalMs),
        // 与 Go 版一致：TTL 200 分钟。
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

    // 不输出访问日志：query 里有播放会话。
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
        // 与 gin 的 RedirectTrailingSlash 一致：去掉末尾的 / 能匹配时重定向，GET 用 301，其它方法用 307。
        if (url.pathname.length > 1 && url.pathname.endsWith('/') && matchRoute(routes, method, segments.slice(0, -1))) {
            res.writeHead(method === 'GET' ? 301 : 307, { Location: `${url.pathname.slice(0, -1)}${url.search}` });
            res.end();
            return;
        }
        log.warn(`收到404请求: ${method} ${url.pathname}`);
        sendJson(res, 404, { error: 'Not Found' });
    });
    // 长时间的视频流不能被服务端切断。
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
