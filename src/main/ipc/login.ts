import { mainWindow } from '../common/mainWindow';
import * as fn from '../../modules/fn_api/api';
import * as loginStore from '../../modules/fn_config/loginStore';
import * as log from '../../modules/logger';
import { withCertificateTrust } from '../../modules/cert_trust';
import { isFnId } from '../../public/fnId';
import type { LoginPageConfig, LoginRequest } from '../../public/ipcChannels';
import { handleFnIdLogin } from '../common/fnId/fnIdLogin';
import { certificateLoginError, establishNewLogin, type IssuedToken, type LoginReply } from '../common/currentLogin';
import { type ChannelHandlers, noPayload } from './adapter';
import { boolean, historyKey, optional, record, string } from './parse';

async function readLoginPageConfig(): Promise<LoginPageConfig> {
    try {
        const login = await loginStore.readCurrentLogin();
        return {
            config: {
                account: login?.account,
                domain: login?.domain,
                hasAccessCode: Boolean(login?.accessCode),
                useHttps: login?.useHttps,
            },
            history: loginStore.listHistory(),
        };
    } catch (error) {
        log.error('读取配置失败:', error);
        return { config: { hasAccessCode: false }, history: [] };
    }
}

async function readCurrentAccessCode(): Promise<{ domain?: string; account?: string; accessCode: string }> {
    const login = await loginStore.readCurrentLogin();
    return { domain: login?.domain, account: login?.account, accessCode: login?.accessCode ?? '' };
}

const HTTPS_PORT_MISMATCH_MESSAGE = '无法用 HTTPS 连接到服务器，请检查 HTTPS 设置和端口。';

const loginFailed = (message: string): IssuedToken => ({ error: { title: '登录失败', message } });

async function requestToken(baseUrl: string, loginData: LoginRequest): Promise<IssuedToken> {
    const outcome = await withCertificateTrust(baseUrl, async () => {
        const response = await new fn.ApiService(baseUrl).login(loginData.username, loginData.password);
        return !response.ok && response.failure.kind === 'certificate'
            ? { ok: false, certificateError: response.failure.message || '未知证书错误' }
            : { ok: true, value: response };
    });
    if (!outcome.ok) {
        log.info(outcome.reason === 'declined' ? '用户取消信任证书，登录取消' : '信任证书后登录仍遇到证书错误');
        return { error: certificateLoginError(outcome.reason) };
    }
    const response = outcome.value;

    if (response.ok) {
        const token = response.data?.token;
        if (!token) {
            log.error('登录失败: 没有有效的登录信息，无法恢复 cookies');
            return loginFailed('没有有效的登录信息，无法恢复 cookies');
        }
        log.info('登录成功，已获取 token');
        return { token, movedTo: response.movedTo };
    }

    const { failure } = response;
    log.error('登录失败:', failure.message);
    return loginFailed(failure.kind === 'https-port-mismatch'
        ? HTTPS_PORT_MISMATCH_MESSAGE
        : failure.message || '登录时发生未知错误，请稍后重试。');
}

async function login(loginData: LoginRequest): Promise<LoginReply> {
    log.info('收到登录请求:', {
        useHttps: loginData.useHttps,
    });

    if (!loginData.domain || !loginData.username || !loginData.password) {
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
    const result = await establishNewLogin(mainWindow.window, {
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

function parseLoginRequest(raw: unknown): LoginRequest {
    const { domain, username, password, accessCode, useHttps } = record(raw, '登录信息');
    return {
        domain: string(domain, '地址'),
        username: string(username, '用户名'),
        password: string(password, '密码'),
        accessCode: optional(accessCode, (value) => string(value, '访问码')),
        useHttps: optional(useHttps, (value) => boolean(value, 'HTTPS 开关')),
    };
}

type LoginChannel = 'login' | 'get-config' | 'get-history-credentials' | 'get-current-access-code' | 'delete-history-item' | 'clear-history';

export const loginHandlers: Pick<ChannelHandlers, LoginChannel> = {
    'login': { parse: parseLoginRequest, handle: login },
    'get-config': { parse: noPayload, handle: readLoginPageConfig },
    'get-history-credentials': { parse: historyKey, handle: (key) => loginStore.historyCredentials(key) },
    'get-current-access-code': { parse: noPayload, handle: readCurrentAccessCode },
    'delete-history-item': { parse: historyKey, handle: (key) => loginStore.removeHistory(key) },
    'clear-history': { parse: noPayload, handle: () => loginStore.clearHistory() },
};
