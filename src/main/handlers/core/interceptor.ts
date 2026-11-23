import { session, OnBeforeRequestListenerDetails, CallbackResponse, Session, WebRequestFilter } from 'electron';
import * as log from '../../../modules/logger';

type BeforeRequestHandler = (details: OnBeforeRequestListenerDetails, callback: (response: CallbackResponse) => void) => void;

type UrlMatcher = (url: URL) => boolean;

interface BeforeRequestInterceptor {
    filter: WebRequestFilter;
    matches: UrlMatcher;
    handler: BeforeRequestHandler;
    name: string;
}

const ANY_SCHEME = new Set(['http:', 'https:', 'ws:', 'wss:']);
const DEFAULT_PORT: Record<string, string> = { 'http:': '80', 'https:': '443', 'ws:': '80', 'wss:': '443' };

function globRegExp(glob: string): RegExp {
    const source = glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${source}$`);
}

function hostMatches(hostPattern: string, hostname: string): boolean {
    if (hostPattern === '*') return true;
    if (hostPattern.startsWith('*.')) {
        const domain = hostPattern.slice(2);
        return hostname === domain || hostname.endsWith(`.${domain}`);
    }
    return hostname === hostPattern;
}

function urlPatternMatcher(pattern: string): UrlMatcher {
    const parts = /^([a-z*]+):\/\/([^/]*?)(?::(\d+|\*))?(\/.*)$/i.exec(pattern);
    if (!parts) {
        log.error(`无法解析的拦截 URL 模式: ${pattern}`);
        return () => false;
    }
    const [, scheme, host, port, path] = parts;
    const protocol = `${scheme.toLowerCase()}:`;
    const hostPattern = host.toLowerCase();
    const pathPattern = globRegExp(path);
    return (url) =>
        (scheme === '*' ? ANY_SCHEME.has(url.protocol) : url.protocol === protocol) &&
        hostMatches(hostPattern, url.hostname) &&
        (!port || port === '*' || (url.port || DEFAULT_PORT[url.protocol]) === port) &&
        pathPattern.test(url.pathname + url.search);
}

function filterMatcher(filter: WebRequestFilter): UrlMatcher {
    const matchers = filter.urls.map(urlPatternMatcher);
    return (url) => matchers.some((matches) => matches(url));
}

function parseUrl(raw: string): URL | null {
    try {
        return new URL(raw);
    } catch {
        return null;
    }
}

class SessionInterceptorManager {
    private readonly beforeRequest: BeforeRequestInterceptor[] = [];
    private session: Session | null = null;

    init(partition: string): void {
        this.session = session.fromPartition(partition);
    }

    run(): void {
        const ses = this.session;
        if (!ses) {
            log.error('Session 未初始化，无法运行');
            return;
        }

        const urls = this.beforeRequest.flatMap(({ filter }) => filter.urls);
        ses.webRequest.onBeforeRequest({ urls }, (details, callback) => {
            const url = parseUrl(details.url);
            const target = url && this.beforeRequest.find(({ matches }) => matches(url));
            if (!target) {
                callback({});
                return;
            }
            try {
                target.handler(details, callback);
            } catch (error) {
                log.error(`beforeRequest 拦截器 ${target.name} 执行失败:`, error);
                callback({});
            }
        });
        log.info('Session 拦截管理器已初始化');
    }

    registerBeforeRequest(filter: WebRequestFilter, handler: BeforeRequestHandler, name: string): void {
        this.beforeRequest.push({ filter, matches: filterMatcher(filter), handler, name });
        log.info(`已注册 beforeRequest 拦截器: ${name}`);
    }

    getSession(): Session | null {
        return this.session;
    }
}

export const interceptor = new SessionInterceptorManager();
