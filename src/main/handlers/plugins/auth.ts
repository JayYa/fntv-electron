import { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { isLoginPage } from '../../common/loginPage';
import { getMainWindow } from '../../common/mainwin';
import * as fn from '../../../modules/fn_api/api';
import { HTTPS_PORT_MISMATCH_MESSAGE, isHttpsPortMismatch } from '../../../modules/fn_api/core/httpsPortMismatch';
import * as loginStore from '../../../modules/fn_config/loginStore';
import { registerHandler } from '../core/ipcHandler';
import * as log from '../../../modules/logger';
import { showCertificateTrustDialog } from '../../../modules/cert_trust';
import { isFnId } from '../../../public/fnId';
import { handleFnIdLogin } from '../core/fnIdLogin';
import { establishNewLogin, type IssuedToken, type LoginReply } from '../../common/currentLogin';

interface LoginData {
    domain: string;
    username: string;
    password: string;
    accessCode?: string;
    useHttps?: boolean;
}

interface HistoryItem {
    domain: string;
    account: string;
}

async function handleGetConfig(event: IpcMainEvent): Promise<void> {
    try {
        const login = await loginStore.readCurrentLogin();
        event.reply('config-data', {
            config: {
                account: login?.account,
                domain: login?.domain,
                hasAccessCode: Boolean(login?.accessCode),
                useHttps: login?.useHttps,
            },
            history: loginStore.listHistory(),
        });
    } catch (error) {
        log.error('读取配置失败:', error);
        event.reply('config-data', { config: {}, history: [] });
    }
}

async function handleGetHistoryCredentials(event: IpcMainEvent, request?: Partial<HistoryItem>): Promise<void> {
    if (!isLoginPage(event)) {
        log.warn('拒绝了非登录页的历史凭据请求');
        return;
    }
    const { domain, account } = request ?? {};
    if (typeof domain !== 'string' || typeof account !== 'string') return;
    try {
        const credentials = await loginStore.historyCredentials({ domain, account });
        event.reply('history-credentials', { domain, account, ...credentials });
    } catch (error) {
        log.error('读取历史凭据失败:', error);
    }
}

async function handleGetCurrentAccessCode(event: IpcMainEvent): Promise<void> {
    if (!isLoginPage(event)) {
        log.warn('拒绝了非登录页的访问码请求');
        return;
    }
    try {
        const login = await loginStore.readCurrentLogin();
        event.reply('current-access-code', { domain: login?.domain, account: login?.account, accessCode: login?.accessCode ?? '' });
    } catch (error) {
        log.error('读取当前访问码失败:', error);
    }
}

async function handleClearHistory(event: IpcMainEvent): Promise<void> {
    try {
        await loginStore.clearHistory();
        event.reply('history-cleared');
    } catch (error) {
        log.error('清除历史记录失败:', error);
    }
}

async function handleDeleteHistoryItem(event: IpcMainEvent, { domain, account }: HistoryItem): Promise<void> {
    try {
        const success = await loginStore.removeHistory({ domain, account });
        if (success) {
            event.reply('history-item-deleted');
        }
    } catch (error) {
        log.error('删除历史记录项失败:', error);
    }
}

const loginFailed = (message: string): IssuedToken => ({ error: { title: '登录失败', message } });

async function requestToken(
    baseUrl: string,
    loginData: LoginData,
    certificateRetryAttempted = false,
): Promise<IssuedToken> {
    const response = await new fn.ApiService(baseUrl).login(loginData.username, loginData.password);

    if (response?.success) {
        const token = response.data.token;
        if (!token) {
            log.error('登录失败: 没有有效的登录信息，无法恢复 cookies');
            return loginFailed('没有有效的登录信息，无法恢复 cookies');
        }
        log.info('登录成功，已获取 token');
        return { token, movedTo: response.moveUrl || undefined };
    }

    if (response?.certificateError) {
        log.info('检测到证书验证错误，询问用户是否信任');
        const shouldTrust = await showCertificateTrustDialog(
            baseUrl,
            response.message || '未知证书错误',
            getMainWindow(),
        );
        if (!shouldTrust) {
            return { error: { title: '登录取消', message: '用户取消信任证书，无法继续登录。' } };
        }
        if (certificateRetryAttempted) {
            return {
                error: {
                    title: '证书验证失败',
                    message: '信任证书后仍无法建立安全连接，请检查服务器证书配置。',
                },
            };
        }
        log.info('用户信任证书，重试登录');
        return requestToken(baseUrl, loginData, true);
    }

    const msg = response ? response.message : '未知错误';
    log.error('登录失败:', msg);
    return loginFailed(isHttpsPortMismatch(msg)
        ? HTTPS_PORT_MISMATCH_MESSAGE
        : msg || '登录时发生未知错误，请稍后重试。');
}

async function handleLogin(_event: IpcMainInvokeEvent, loginData: LoginData): Promise<LoginReply> {
    log.info('收到登录请求:', {
        useHttps: loginData?.useHttps,
    });

    if (!loginData || !loginData.domain || !loginData.username || !loginData.password) {
        log.error('登录失败: 缺少必要的登录信息');
        return {
            ok: false,
            error: { title: '登录失败', message: '请提供完整的登录信息。' },
        };
    }

    if (isFnId(loginData.domain)) {
        log.info('检测到 FN ID 格式，使用 FN Connect OAuth 登录');
        return handleFnIdLogin(loginData);
    }

    const accessCode = loginData.accessCode?.trim() || '';
    const result = await establishNewLogin(getMainWindow, {
        access: {
            baseUrl: loginData.useHttps ? `https://${loginData.domain}` : `http://${loginData.domain}`,
            accessCode,
        },
        account: loginData.username,
        token: (baseUrl) => requestToken(baseUrl, loginData),
        history: {
            domain: loginData.domain,
            account: loginData.username,
            password: loginData.password,
            accessCode,
            useHttps: loginData.useHttps,
        },
    });
    return result.ok ? { ok: true } : { ok: false, error: result.error };
}

function init(): void {
    registerHandler('get-config', handleGetConfig);
    registerHandler('get-history-credentials', handleGetHistoryCredentials);
    registerHandler('get-current-access-code', handleGetCurrentAccessCode);
    registerHandler('clear-history', handleClearHistory);
    registerHandler('delete-history-item', handleDeleteHistoryItem);
    registerHandler('login', handleLogin, { useHandle: true });
}

export {
    init
};
