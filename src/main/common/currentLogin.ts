import * as fnConfig from '../../modules/fn_config/config';
import { restoreCookies } from '../../modules/fn_config/cookie';
import * as log from '../../modules/logger';
import { applyVerifiedOriginToFnConnectBaseUrl } from '../handlers/core/fnConnect';
import { AccessCodeVerificationError, establishAccessCodeSession } from './accessCodeSession';
import { LOGIN_PAGE_PATH } from './loginPage';

export interface LoginError {
    title: string;
    message: string;
}

export type IssuedToken = { token: string; movedTo?: string } | { error: LoginError };

export interface LoginRequest {
    baseUrl: string;
    accessCode: string;
    account: string;
    credential: { savedToken: string } | { issueToken(baseUrl: string): Promise<IssuedToken> };
    history?: fnConfig.AddHistoryParams;
}

export type LoginFailureReason =
    | 'access-code-rejected'
    | 'access-code-unreachable'
    | 'token-not-issued'
    | 'session-not-restored'
    | 'secure-storage'
    | 'unexpected';

export type LoginResult = { ok: true } | { ok: false; reason: LoginFailureReason; error: LoginError };

interface LoginWindow {
    loadURL(url: string): Promise<void> | void;
    loadFile(filePath: string): Promise<void> | void;
}

export async function establishAccessGrant(baseUrl: string, accessCode: string): Promise<string> {
    const session = await establishAccessCodeSession(baseUrl, accessCode);
    return applyVerifiedOriginToFnConnectBaseUrl(baseUrl, session.baseUrl);
}

export function showLoginPage(window: LoginWindow): void {
    void Promise.resolve(window.loadFile(LOGIN_PAGE_PATH)).catch((error: unknown) => {
        log.error('加载登录页失败:', error);
    });
}

const fail = (reason: LoginFailureReason, error: LoginError): LoginResult => ({ ok: false, reason, error });

export function accessCodeLoginError(error: AccessCodeVerificationError): LoginError {
    return error.reason === 'rejected'
        ? { title: '访问码错误', message: '访问码错误，请检查后重试。' }
        : { title: '连接失败', message: '无法连接到访问码验证服务，请检查地址、证书或网络连接。' };
}

function unexpectedFailure(error: unknown): LoginResult {
    const message = error instanceof Error ? error.message : '';
    return /安全存储|密钥环/.test(message)
        ? fail('secure-storage', { title: '无法安全保存登录信息', message })
        : fail('unexpected', { title: '连接失败', message: '无法连接到服务器，请检查域名是否正确或网络连接是否正常。' });
}

export async function establishCurrentLogin(windowForWebUi: () => LoginWindow, request: LoginRequest): Promise<LoginResult> {
    const { credential } = request;
    const isNewLogin = 'issueToken' in credential;
    try {
        let baseUrl = await establishAccessGrant(request.baseUrl, request.accessCode);

        let token: string;
        if (isNewLogin) {
            const issued = await credential.issueToken(baseUrl);
            if ('error' in issued) return fail('token-not-issued', issued.error);
            token = issued.token;
            baseUrl = issued.movedTo || baseUrl;
        } else {
            token = credential.savedToken;
        }

        if (!await restoreCookies(baseUrl, token, isNewLogin)) {
            return fail('session-not-restored', { title: '登录失败', message: '无法恢复登录状态，请重新登录。' });
        }

        if (isNewLogin || baseUrl !== request.baseUrl) {
            await fnConfig.saveConfig({
                account: request.account,
                domain: baseUrl,
                token,
                accessCode: request.accessCode,
                useHttps: baseUrl.startsWith('https://'),
            });
        }
        if (request.history) {
            await fnConfig.addHistory(request.history);
        }

        log.info('已建立当前登录，进入网页端, domain:', baseUrl);
        void Promise.resolve(windowForWebUi().loadURL(`${baseUrl}/v`)).catch((error: unknown) => {
            log.error('加载网页端失败:', error);
        });
        return { ok: true };
    } catch (error) {
        if (error instanceof AccessCodeVerificationError) {
            log.warn('访问码验证失败:', error.reason);
            return fail(
                error.reason === 'rejected' ? 'access-code-rejected' : 'access-code-unreachable',
                accessCodeLoginError(error),
            );
        }
        log.error('建立当前登录失败:', error);
        return unexpectedFailure(error);
    }
}
