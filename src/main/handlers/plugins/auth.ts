import { IpcMainEvent } from 'electron';
import { isLoginPage } from '../../common/loginPage';
import { getMainWindow } from '../../common/mainwin';
import * as fn from '../../../modules/fn_api/api';
import { HTTPS_PORT_MISMATCH_MESSAGE, isHttpsPortMismatch } from '../../../modules/fn_api/core/httpsPortMismatch';
import * as fnConfig from '../../../modules/fn_config/config';
import { registerHandler } from '../core/ipcHandler';
import * as log from '../../../modules/logger';
import { showCertificateTrustDialog, addTrustedHost } from '../../../modules/cert_trust';
import { isFnId, handleFnIdLogin } from './fnid_login';
import { establishCurrentLogin, type IssuedToken } from '../../common/currentLogin';

/**
 * 用户认证插件
 * 处理登录、配置管理、历史记录等功能
 */

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

let fnIdLoginInProgress = false;

// 获取配置处理
async function handleGetConfig(event: IpcMainEvent): Promise<void> {
    try {
        const config = (await fnConfig.readConfig()) || {};
        const history = await fnConfig.getHistory();
        // 这里按字段白名单发送：密码、访问码和 token 都不进列表数据，凭据走下面的按需频道。
        event.reply('config-data', {
            config: {
                account: config.account,
                domain: config.domain,
                hasAccessCode: Boolean(config.accessCode),
                useHttps: config.useHttps,
            },
            history: history.map(({ domain, account, useHttps }) => ({ domain, account, useHttps })),
        });
    } catch (error) {
        log.error('读取配置失败:', error);
        event.reply('config-data', { config: {}, history: [] });
    }
}

// 按需读取一条历史记录的凭据，明文只回给本地登录页。回复带上域名和账号，登录页靠它丢弃连点时迟到的回复。
async function handleGetHistoryCredentials(event: IpcMainEvent, request?: Partial<HistoryItem>): Promise<void> {
    if (!isLoginPage(event)) {
        log.warn('拒绝了非登录页的历史凭据请求');
        return;
    }
    const { domain, account } = request ?? {};
    if (typeof domain !== 'string' || typeof account !== 'string') return;
    try {
        const credentials = await fnConfig.getHistoryCredentials({ domain, account });
        event.reply('history-credentials', { domain, account, ...credentials });
    } catch (error) {
        log.error('读取历史凭据失败:', error);
    }
}

// 按需读取当前配置的访问码，用于回填登录页。
async function handleGetCurrentAccessCode(event: IpcMainEvent): Promise<void> {
    if (!isLoginPage(event)) {
        log.warn('拒绝了非登录页的访问码请求');
        return;
    }
    try {
        const { domain, account, accessCode } = (await fnConfig.readConfig()) || {};
        event.reply('current-access-code', { domain, account, accessCode: accessCode || '' });
    } catch (error) {
        log.error('读取当前访问码失败:', error);
    }
}

// 清除历史记录处理
function handleClearHistory(event: IpcMainEvent): void {
    try {
        fnConfig.clearHistory();
        event.reply('history-cleared');
    } catch (error) {
        log.error('清除历史记录失败:', error);
    }
}

// 删除单个历史记录处理
function handleDeleteHistoryItem(event: IpcMainEvent, { domain, account }: HistoryItem): void {
    try {
        const success = fnConfig.deleteHistoryItem({ domain, account });
        if (success) {
            event.reply('history-item-deleted');
        }
    } catch (error) {
        log.error('删除历史记录项失败:', error);
    }
}

const loginFailed = (message: string): IssuedToken => ({ error: { title: '登录失败', message } });

/** 用账号密码向飞牛影视服务换 token；证书不受信任时问用户，信任后重试一次。 */
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
        return { token, baseUrl: response.moveUrl || undefined };
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
        addTrustedHost(baseUrl);
        log.info('用户信任证书，重试登录');
        return requestToken(baseUrl, loginData, true);
    }

    const msg = response ? response.message : '未知错误';
    log.error('登录失败:', msg);
    return loginFailed(isHttpsPortMismatch(msg)
        ? HTTPS_PORT_MISMATCH_MESSAGE
        : msg || '登录时发生未知错误，请稍后重试。');
}

// 用户登录处理
async function handleLogin(event: IpcMainEvent, loginData: LoginData): Promise<void> {
    log.info('收到登录请求:', {
        useHttps: loginData?.useHttps,
    });

    if (!loginData || !loginData.domain || !loginData.username || !loginData.password) {
        log.error('登录失败: 缺少必要的登录信息');
        event.reply('login-error', {
            title: '登录失败',
            message: '请提供完整的登录信息。'
        });
        return;
    }

    // FN ID 登录分支
    if (isFnId(loginData.domain)) {
        if (fnIdLoginInProgress) {
            event.reply('login-error', {
                title: 'FN ID 登录进行中',
                message: '请先在已打开的 FN Connect 窗口中完成或取消登录。'
            });
            return;
        }

        log.info('检测到 FN ID 格式，使用 FN Connect OAuth 登录');
        fnIdLoginInProgress = true;
        try {
            await handleFnIdLogin(event, loginData);
        } finally {
            fnIdLoginInProgress = false;
        }
        return;
    }

    const accessCode = loginData.accessCode?.trim() || '';
    const result = await establishCurrentLogin(getMainWindow, {
        baseUrl: loginData.useHttps ? `https://${loginData.domain}` : `http://${loginData.domain}`,
        accessCode,
        account: loginData.username,
        credential: { issueToken: (baseUrl) => requestToken(baseUrl, loginData) },
        history: {
            domain: loginData.domain,
            account: loginData.username,
            password: loginData.password,
            accessCode,
            useHttps: loginData.useHttps,
        },
    });
    if (!result.ok) {
        event.reply('login-error', result.error);
    }
}

// 注册认证相关处理器
function init(): void {
    registerHandler('get-config', handleGetConfig);
    registerHandler('get-history-credentials', handleGetHistoryCredentials);
    registerHandler('get-current-access-code', handleGetCurrentAccessCode);
    registerHandler('clear-history', handleClearHistory);
    registerHandler('delete-history-item', handleDeleteHistoryItem);
    registerHandler('login', handleLogin);
}

export {
    init
};
