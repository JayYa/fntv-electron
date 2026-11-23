import { session, OnBeforeRequestListenerDetails, OnBeforeSendHeadersListenerDetails, OnHeadersReceivedListenerDetails, OnBeforeRedirectListenerDetails, OnResponseStartedListenerDetails, OnCompletedListenerDetails, OnErrorOccurredListenerDetails, Session } from 'electron';
import * as log from '../../../modules/logger';

interface InterceptorFilter {
    urls: string[];
}

interface InterceptorCallback {
    (response?: { cancel?: boolean; redirectURL?: string; responseHeaders?: Record<string, string | string[]> }): void;
}

interface BeforeRequestHandler {
    (details: OnBeforeRequestListenerDetails, callback: InterceptorCallback): void;
}

interface BeforeSendHeadersHandler {
    (details: OnBeforeSendHeadersListenerDetails, callback: InterceptorCallback): void;
}

interface HeaderReceivedHandler {
    (details: OnHeadersReceivedListenerDetails, callback: InterceptorCallback): void;
}

interface BeforeRedirectHandler {
    (details: OnBeforeRedirectListenerDetails): void;
}

interface ResponseStartedHandler {
    (details: OnResponseStartedListenerDetails): void;
}

interface CompletedHandler {
    (details: OnCompletedListenerDetails): void;
}

interface ErrorOccurredHandler {
    (details: OnErrorOccurredListenerDetails): void;
}

interface InterceptorItem<T> {
    filter: InterceptorFilter;
    handler: T;
    name: string;
}

interface Interceptors {
    beforeRequest: InterceptorItem<BeforeRequestHandler>[];
    beforeSendHeaders: InterceptorItem<BeforeSendHeadersHandler>[];
    headerReceived: InterceptorItem<HeaderReceivedHandler>[];
    beforeRedirect: InterceptorItem<BeforeRedirectHandler>[];
    responseStarted: InterceptorItem<ResponseStartedHandler>[];
    completed: InterceptorItem<CompletedHandler>[];
    errorOccurred: InterceptorItem<ErrorOccurredHandler>[];
}

class SessionInterceptorManager {
    private interceptors: Interceptors;
    private session: Session | null = null;

    constructor() {
        this.interceptors = {
            beforeRequest: [],
            beforeSendHeaders: [],
            headerReceived: [],
            beforeRedirect: [],
            responseStarted: [],
            completed: [],
            errorOccurred: []
        };
    }

    init(partition: string): void {
        this.session = session.fromPartition(partition);
    }

    run(): void {
        if (!this.session) {
            log.error('Session 未初始化，无法运行');
            return;
        }

        this._setupInterceptors();
        log.info('Session 拦截管理器已初始化');
    }

    registerBeforeRequest(filter: InterceptorFilter, handler: BeforeRequestHandler, name: string = 'unknown'): void {
        this.interceptors.beforeRequest.push({
            filter,
            handler,
            name
        });
        log.info(`已注册 beforeRequest 拦截器: ${name}`);
    }

    registerBeforeSendHeaders(filter: InterceptorFilter, handler: BeforeSendHeadersHandler, name: string = 'unknown'): void {
        this.interceptors.beforeSendHeaders.push({
            filter,
            handler,
            name
        });
        log.info(`已注册 beforeSendHeaders 拦截器: ${name}`);
    }

    registerHeaderReceived(filter: InterceptorFilter, handler: HeaderReceivedHandler, name: string = 'unknown'): void {
        this.interceptors.headerReceived.push({
            filter,
            handler,
            name
        });
        log.info(`已注册 headerReceived 拦截器: ${name}`);
    }

    private _setupInterceptors(): void {
        if (!this.session) {
            log.error('Session 未初始化，无法设置拦截器');
            return;
        }

        Object.keys(this.interceptors).forEach(type => {
            const method = 'on' + type.charAt(0).toUpperCase() + type.slice(1);
            const webRequestMethod = (this.session!.webRequest as any)[method];
            if (typeof webRequestMethod !== 'function') return;
            
            (this.interceptors as any)[type].forEach((interceptor: any) => {
                webRequestMethod.call(
                    this.session!.webRequest,
                    interceptor.filter,
                    (details: any, callback?: any) => {
                        try {
                            interceptor.handler(details, callback);
                        } catch (error) {
                            log.error(`${type} 拦截器 ${interceptor.name} 执行失败:`, error);
                            callback && callback({});
                        }
                    }
                );
            });
        });
    }

    getSession(): Session | null {
        return this.session;
    }

    clearAllInterceptors(): void {
        Object.keys(this.interceptors).forEach(key => {
            (this.interceptors as any)[key] = [];
        });
        log.info('所有拦截器已清除');
    }
}

const instance = new SessionInterceptorManager();

function getInstance(): SessionInterceptorManager {
    return instance;
}

const interceptor = instance;

export {
    getInstance,
    SessionInterceptorManager,
    interceptor
};
