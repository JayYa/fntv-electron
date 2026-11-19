/**
 * 建立当前登录（current login）：密码登录、FN ID 登录和启动时恢复都经过这里。
 * 取 token 的方式各不相同，由调用方提供；访问码验证、地址确定、恢复 Cookie、保存和进入网页端的顺序只在这里。
 */

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

export interface HistoryEntry {
    domain: string;
    account: string;
    password: string;
    accessCode: string;
    useHttps?: boolean;
}

export type IssuedToken = { token: string; baseUrl?: string } | { error: LoginError };

export interface LoginRequest {
    baseUrl: string;
    accessCode: string;
    account: string;
    /**
     * savedToken：启动时从配置读出，先向飞牛影视服务校验，没变就不重新保存。
     * issueToken：这次登录取得，拿到确定后的地址；返回的 baseUrl 替换当前地址（login 接口的 moveUrl）。
     */
    credential: { savedToken: string } | { issueToken(baseUrl: string): Promise<IssuedToken> };
    /** 成功后写进登录历史；启动时不写。 */
    history?: HistoryEntry;
}

export type LoginFailureReason =
    | 'access-code-rejected'
    | 'access-code-unreachable'
    | 'token-not-issued'
    | 'session-not-restored'
    | 'failed';

export type LoginResult = { ok: true } | { ok: false; reason: LoginFailureReason; error: LoginError };

interface LoginWindow {
    loadURL(url: string): Promise<void> | void;
    loadFile(filePath: string): Promise<void> | void;
}

/** 验证访问码（没有访问码时只清掉上次的访问授权），返回验证后的地址：origin 取验证结果，路径保留原地址的。 */
export async function verifyAccessCode(baseUrl: string, accessCode: string): Promise<string> {
    const session = await establishAccessCodeSession(baseUrl, accessCode);
    return applyVerifiedOriginToFnConnectBaseUrl(baseUrl, session.baseUrl);
}

export function showLoginPage(window: LoginWindow): void {
    void Promise.resolve(window.loadFile(LOGIN_PAGE_PATH)).catch((error: unknown) => {
        log.error('加载登录页失败:', error);
    });
}

const fail = (reason: LoginFailureReason, error: LoginError): LoginResult => ({ ok: false, reason, error });

function accessCodeFailure(error: AccessCodeVerificationError): LoginResult {
    return error.reason === 'rejected'
        ? fail('access-code-rejected', { title: '访问码错误', message: '访问码错误，请检查后重试。' })
        : fail('access-code-unreachable', {
            title: '连接失败',
            message: '无法连接到访问码验证服务，请检查地址、证书或网络连接。',
        });
}

function unexpectedFailure(error: unknown): LoginResult {
    const message = error instanceof Error ? error.message : '';
    return /安全存储|密钥环/.test(message)
        ? fail('failed', { title: '无法安全保存登录信息', message })
        : fail('failed', { title: '连接失败', message: '无法连接到服务器，请检查域名是否正确或网络连接是否正常。' });
}

/**
 * 建立当前登录，成功后主窗口进入网页端。
 * Cookie 恢复成功之后才保存当前登录和登录历史，失败时什么都不落盘。
 * window 只在成功时取。失败不导航：登录页留在原处显示 error，启动时由调用方回到登录页。
 */
export async function establishCurrentLogin(window: () => LoginWindow, request: LoginRequest): Promise<LoginResult> {
    const { credential } = request;
    const isNewLogin = 'issueToken' in credential;
    try {
        let baseUrl = await verifyAccessCode(request.baseUrl, request.accessCode);

        let token: string;
        if (isNewLogin) {
            const issued = await credential.issueToken(baseUrl);
            if ('error' in issued) return fail('token-not-issued', issued.error);
            token = issued.token;
            // 换到的地址不再验证访问码；origin 变了时访问授权可能对不上新地址
            baseUrl = issued.baseUrl || baseUrl;
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
        void Promise.resolve(window().loadURL(`${baseUrl}/v`)).catch((error: unknown) => {
            log.error('加载网页端失败:', error);
        });
        return { ok: true };
    } catch (error) {
        if (error instanceof AccessCodeVerificationError) {
            log.warn('访问码验证失败:', error.reason);
            return accessCodeFailure(error);
        }
        log.error('建立当前登录失败:', error);
        return unexpectedFailure(error);
    }
}
