import { session, OnBeforeRequestListenerDetails, CallbackResponse, Session, WebRequestFilter } from 'electron';
import * as log from '../../../modules/logger';

type BeforeRequestHandler = (details: OnBeforeRequestListenerDetails, callback: (response: CallbackResponse) => void) => void;

interface BeforeRequestInterceptor {
    filter: WebRequestFilter;
    handler: BeforeRequestHandler;
    name: string;
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

        for (const { filter, handler, name } of this.beforeRequest) {
            ses.webRequest.onBeforeRequest(filter, (details, callback) => {
                try {
                    handler(details, callback);
                } catch (error) {
                    log.error(`beforeRequest 拦截器 ${name} 执行失败:`, error);
                    callback({});
                }
            });
        }
        log.info('Session 拦截管理器已初始化');
    }

    registerBeforeRequest(filter: WebRequestFilter, handler: BeforeRequestHandler, name: string): void {
        this.beforeRequest.push({ filter, handler, name });
        log.info(`已注册 beforeRequest 拦截器: ${name}`);
    }

    getSession(): Session | null {
        return this.session;
    }
}

export const interceptor = new SessionInterceptorManager();
