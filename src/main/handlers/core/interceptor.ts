import { OnBeforeRequestListenerDetails, CallbackResponse, Session, WebRequestFilter } from 'electron';
import * as log from '../../../modules/logger';

type BeforeRequestHandler = (details: OnBeforeRequestListenerDetails, callback: (response: CallbackResponse) => void) => void;

type UrlMatcher = (url: URL) => boolean;

interface BeforeRequestInterceptor {
    filter: WebRequestFilter;
    matches: UrlMatcher;
    handler: BeforeRequestHandler;
    name: string;
}

const SCHEMES: Record<string, string[]> = { '*': ['http:', 'https:'], http: ['http:'], https: ['https:'] };

function globRegExp(glob: string): RegExp {
    const source = glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${source}$`);
}

function urlPatternMatcher(pattern: string): UrlMatcher {
    const parts = /^(\*|https?):\/\/([^/:]+)(\/.*)$/.exec(pattern);
    if (!parts) throw new Error(`无法解析的拦截 URL 模式: ${pattern}`);
    const [, scheme, host, path] = parts;
    const pathPattern = globRegExp(path);
    return (url) =>
        SCHEMES[scheme].includes(url.protocol) &&
        (host === '*' || url.hostname === host.toLowerCase()) &&
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
    private attached = false;

    attach(ses: Session): void {
        this.attached = true;
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
        if (this.attached) throw new Error(`拦截已挂载到会话，无法再注册 beforeRequest 拦截器: ${name}`);
        this.beforeRequest.push({ filter, matches: filterMatcher(filter), handler, name });
        log.info(`已注册 beforeRequest 拦截器: ${name}`);
    }
}

export const interceptor = new SessionInterceptorManager();
