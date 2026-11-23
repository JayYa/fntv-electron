import { session } from 'electron';
import log from '../logger';
import { ApiService } from '../fn_api/api';

export async function restoreCookies(domain: string, token: string, isLogin: boolean = false): Promise<boolean> {
    if (!token) {
        log.info('没有已保存的登录信息，跳过恢复 cookies');
        return false;
    }

    if (!domain || typeof domain !== 'string' || !domain.startsWith('http')) {
        log.warn('无效的域名格式:', domain);
        return false;
    }

    if (!isLogin) {
        const fnapi = new ApiService(domain, token);
        const response = await fnapi.getUserInfo(5000, 0);
        if (!response || !response.success) {
            log.warn('已保存的 token 无效');
            return false;
        }
        log.info('已保存的登录状态验证通过');
    }

    log.info('从配置中恢复 cookies, domain:', domain);

    const ses = session.fromPartition('persist:fntv');
    try {
        const isHttps = domain.startsWith('https://');

        await ses.cookies.remove(domain, 'Trim-MC-token');

        await ses.cookies.set({
            url: domain,
            name: 'Trim-MC-token',
            value: token,
            path: '/',
            secure: isHttps,
            httpOnly: false,
            sameSite: isHttps ? 'no_restriction' : 'lax'
        });

        await ses.cookies.set({
            url: domain,
            name: 'mode',
            value: 'relay',
            path: '/',
            secure: isHttps,
            httpOnly: false,
            sameSite: isHttps ? 'no_restriction' : 'lax'
        });

        return true;
    } catch (error) {
        log.error('Cookie 设置失败:', error);
        return false;
    }
}
