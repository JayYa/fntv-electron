import { session, type Session } from 'electron';
import * as log from '../../modules/logger';

export const WEB_UI_SESSION_PARTITION = 'persist:fntv';

const CACHE_LIMIT_BYTES = 100 * 1024 * 1024;
const CACHE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const LEAVE_PATHS = ['/v/login', '/v/welcome', '/v/api/v1/user/logout'];
const LEAVE_URLS = LEAVE_PATHS.flatMap((path) => [`http://*${path}`, `https://*${path}`]);

const webUiSession = (): Session => session.fromPartition(WEB_UI_SESSION_PARTITION);

export function gatewaySession(): Session {
    return webUiSession();
}

export async function installLoginCookies(baseUrl: string, token: string): Promise<boolean> {
    const cookies = webUiSession().cookies;
    const secure = baseUrl.startsWith('https://');
    const cookie = (name: string, value: string) => ({
        url: baseUrl,
        name,
        value,
        path: '/',
        secure,
        httpOnly: false,
        sameSite: secure ? 'no_restriction' as const : 'lax' as const,
    });
    try {
        await cookies.remove(baseUrl, 'Trim-MC-token');
        await cookies.set(cookie('Trim-MC-token', token));
        await cookies.set(cookie('mode', 'relay'));
        return true;
    } catch (error) {
        log.error('Cookie 设置失败:', error);
        return false;
    }
}

export function clearCookies(): Promise<void> {
    return webUiSession().clearStorageData({ storages: ['cookies'] }).then(
        () => { log.info('会话 Cookie 已清除'); },
        (error: unknown) => { log.error('清除会话 Cookie 失败:', error); },
    );
}

async function clearCacheOverLimit(ses: Session): Promise<void> {
    try {
        const usage = await ses.getCacheSize();
        log.info('当前缓存使用量：', Math.round(usage / (1024 * 1024)), 'MB');
        if (usage > CACHE_LIMIT_BYTES) {
            await ses.clearCache();
            log.info('已清理缓存文件夹');
        }
    } catch (err) {
        log.error('检查缓存使用量失败:', err);
    }
}

export function start(onLeave: () => Promise<void>): void {
    const ses = webUiSession();
    ses.webRequest.onBeforeRequest({ urls: LEAVE_URLS }, (_details, callback) => {
        log.info('网页端请求登录页或登出，结束当前登录');
        callback({ cancel: true });
        void onLeave();
    });
    void clearCacheOverLimit(ses);
    setInterval(() => { void clearCacheOverLimit(ses); }, CACHE_CHECK_INTERVAL_MS);
}
