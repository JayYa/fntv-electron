import { Session } from 'electron';
import { interceptor } from '../core/interceptor';
import * as log from '../../../modules/logger';

function setupCacheManagement(ses: Session): void {
    const checkAndClearCache = async (): Promise<void> => {
        try {
            const usage = await ses.getCacheSize();
            log.info('当前缓存使用量：', Math.round(usage / (1024 * 1024)), 'MB');

            if (usage > 100 * 1024 * 1024) {
                await ses.clearCache();
                log.info('已清理缓存文件夹');
            }
        } catch (err) {
            log.error('检查缓存使用量失败:', err);
        }
    };

    checkAndClearCache();

    setInterval(checkAndClearCache, 6 * 60 * 60 * 1000);
}

function init(): void {
    const ses = interceptor.getSession();
    if (ses) {
        setupCacheManagement(ses);
    }
}

export {
    init,
};
