import { dialog, type BrowserWindow } from 'electron';
import { isTrusted } from '../../modules/cert_trust';
import { clearAccessGrants, getAccessCookieHeader } from '../../modules/fn_api/accessGrant';
import { ApiService } from '../../modules/fn_api/api';
import * as loginStore from '../../modules/fn_config/loginStore';
import * as log from '../../modules/logger';
import { applyVerifiedOriginToFnConnectBaseUrl } from '../handlers/core/fnConnect';
import { AccessCodeVerificationError, establishAccessCodeSession, type AccessCodeSessionResult } from './accessCodeSession';
import { LOGIN_PAGE_PATH } from './loginPage';
import * as webUiSession from './webUiSession';

export interface LoginError {
    title: string;
    message: string;
}

export type IssuedToken = { token: string; movedTo?: string } | { error: LoginError };

export type LoginFailureReason =
    | 'access-code-rejected'
    | 'access-code-unreachable'
    | 'certificate-declined'
    | 'token-not-issued'
    | 'saved-token-invalid'
    | 'session-not-restored'
    | 'secure-storage'
    | 'unexpected';

export type LoginResult = { ok: true } | { ok: false; reason: LoginFailureReason; error: LoginError };

export type LoginReply = { ok: true } | { ok: false; error: LoginError };

export class LoginFailedError extends Error {
    constructor(readonly reason: LoginFailureReason, readonly loginError: LoginError) {
        super(loginError.message);
        this.name = 'LoginFailedError';
    }
}

interface LoginWindow {
    loadURL(url: string): Promise<void> | void;
    loadFile(filePath: string): Promise<void> | void;
}

function accessCodeFailure(error: AccessCodeVerificationError): LoginFailedError {
    if (error.reason === 'certificate-declined') {
        return new LoginFailedError('certificate-declined', { title: '登录取消', message: '用户取消信任证书，无法继续登录。' });
    }
    return error.reason === 'rejected'
        ? new LoginFailedError('access-code-rejected', { title: '访问码错误', message: '访问码错误，请检查后重试。' })
        : new LoginFailedError('access-code-unreachable', {
            title: '连接失败',
            message: '无法连接到访问码验证服务，请检查地址、证书或网络连接。',
        });
}

export class GrantedBaseUrl {
    private constructor(
        readonly baseUrl: string,
        readonly accessCode: string,
        private readonly grant: AccessCodeSessionResult,
    ) {}

    static async verify(baseUrl: string, accessCode: string): Promise<GrantedBaseUrl> {
        try {
            const grant = await establishAccessCodeSession(baseUrl, accessCode);
            return new GrantedBaseUrl(applyVerifiedOriginToFnConnectBaseUrl(baseUrl, grant.baseUrl), accessCode, grant);
        } catch (error) {
            if (!(error instanceof AccessCodeVerificationError)) throw error;
            log.warn('访问码验证失败:', error.reason);
            throw accessCodeFailure(error);
        }
    }

    current(): Promise<GrantedBaseUrl> {
        const { baseUrl, cookie } = this.grant;
        return getAccessCookieHeader(baseUrl) === cookie
            ? Promise.resolve(this)
            : GrantedBaseUrl.verify(this.baseUrl, this.accessCode);
    }
}

export const verifyAccess = (baseUrl: string, accessCode: string): Promise<GrantedBaseUrl> =>
    GrantedBaseUrl.verify(baseUrl, accessCode);

const fail = (reason: LoginFailureReason, error: LoginError): LoginResult => ({ ok: false, reason, error });

export function showLoginPage(window: LoginWindow): void {
    void Promise.resolve(window.loadFile(LOGIN_PAGE_PATH)).catch((error: unknown) => {
        log.error('加载登录页失败:', error);
    });
}

function unexpectedFailure(error: unknown): LoginResult {
    const message = error instanceof Error ? error.message : '';
    return /安全存储|密钥环/.test(message)
        ? fail('secure-storage', { title: '无法安全保存登录信息', message })
        : fail('unexpected', { title: '连接失败', message: '无法连接到服务器，请检查域名是否正确或网络连接是否正常。' });
}

export type LoginAccess = GrantedBaseUrl | { baseUrl: string; accessCode: string };

interface LoginSteps {
    access: LoginAccess;
    account: string;
    token(baseUrl: string): Promise<IssuedToken>;
    isNewLogin: boolean;
    history?: loginStore.NewHistoryEntry;
}

async function savedTokenAccepted(baseUrl: string, token: string): Promise<boolean> {
    return new ApiService(baseUrl, token).tokenAccepted();
}

async function establish(windowForWebUi: () => LoginWindow, steps: LoginSteps): Promise<LoginResult> {
    const { access, isNewLogin } = steps;
    try {
        const granted = access instanceof GrantedBaseUrl
            ? await access.current()
            : await verifyAccess(access.baseUrl, access.accessCode);

        const issued = await steps.token(granted.baseUrl);
        if ('error' in issued) return fail('token-not-issued', issued.error);
        const { token } = issued;
        const baseUrl = issued.movedTo || granted.baseUrl;

        if (!isNewLogin && !await savedTokenAccepted(baseUrl, token)) {
            return fail('saved-token-invalid', { title: '登录失败', message: '已保存的登录已失效，请重新登录。' });
        }

        if (!token || !await webUiSession.installLoginCookies(baseUrl, token)) {
            return fail('session-not-restored', { title: '登录失败', message: '无法恢复登录状态，请重新登录。' });
        }

        const login = {
            account: steps.account,
            domain: baseUrl,
            token,
            accessCode: granted.accessCode,
            useHttps: baseUrl.startsWith('https://'),
        };
        if (steps.history) {
            await loginStore.saveNewLogin(login, steps.history);
        } else if (isNewLogin || baseUrl !== access.baseUrl) {
            await loginStore.saveCurrentLogin(login);
        }

        log.info('已建立当前登录，进入网页端');
        void Promise.resolve(windowForWebUi().loadURL(`${baseUrl}/v`)).catch((error: unknown) => {
            log.error('加载网页端失败:', error);
        });
        return { ok: true };
    } catch (error) {
        if (error instanceof LoginFailedError) return fail(error.reason, error.loginError);
        log.error('建立当前登录失败:', error);
        return unexpectedFailure(error);
    }
}

export interface NewLogin {
    access: LoginAccess;
    account: string;
    token: string | ((baseUrl: string) => Promise<IssuedToken>);
    history: loginStore.NewHistoryEntry;
}

export function establishNewLogin(windowForWebUi: () => LoginWindow, login: NewLogin): Promise<LoginResult> {
    const { token } = login;
    return establish(windowForWebUi, {
        access: login.access,
        account: login.account,
        token: typeof token === 'string' ? async () => ({ token }) : token,
        isNewLogin: true,
        history: login.history,
    });
}

const END_LOGIN_TIMEOUT_MS = 5000;

export async function endCurrentLogin(window: LoginWindow): Promise<void> {
    log.info('结束当前登录，清空 token、访问授权和 Cookie');
    clearAccessGrants();
    const clearing = Promise.all([
        loginStore.clearToken().then(
            (cleared) => { if (cleared) log.info('已清空配置中的登录 token'); },
            (error: unknown) => { log.error('清空配置中的登录 token 失败:', error); },
        ),
        webUiSession.clearCookies(),
    ]);
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
            log.warn(`结束当前登录的清理 ${END_LOGIN_TIMEOUT_MS / 1000} 秒内没有完成，先显示登录页`);
            resolve();
        }, END_LOGIN_TIMEOUT_MS);
    });
    await Promise.race([clearing, timedOut]);
    clearTimeout(timer);
    showLoginPage(window);
}

async function readSavedLogin(window: BrowserWindow): Promise<loginStore.SavedLogin | null> {
    try {
        return await loginStore.readCurrentLogin();
    } catch (error) {
        const message = error instanceof Error ? error.message : '无法读取配置文件';
        log.error('读取配置失败:', error);
        await dialog.showMessageBox(window, {
            type: 'error',
            title: '无法读取配置',
            message,
            detail: '请检查配置文件 ~/.fntv/config.json 是否可读，然后重新登录。',
        });
        return null;
    }
}

export async function restoreAtStartup(window: BrowserWindow): Promise<void> {
    const saved = await readSavedLogin(window);
    if (!saved?.token || !saved.domain?.startsWith('http')) {
        log.warn('没有可恢复的当前登录，显示登录页');
        showLoginPage(window);
        return;
    }

    const result = await establish(() => window, {
        access: { baseUrl: saved.domain, accessCode: saved.accessCode || '' },
        account: saved.account || '',
        token: async () => ({ token: saved.token }),
        isNewLogin: false,
    });
    if (!result.ok) {
        log.warn('恢复当前登录失败，跳转到登录页面:', result.reason);
        showLoginPage(window);
    }
}

export interface CurrentConnection {
    baseUrl: string;
    token: string;
    account: string;
    accessCookie: string;
    trustedHost: boolean;
}

export async function currentConnection(): Promise<CurrentConnection> {
    const login = await loginStore.readCurrentLogin();
    if (!login?.domain || !login.token || !login.account) {
        throw new Error('无法找到有效的服务器登录配置');
    }
    return {
        baseUrl: login.domain,
        token: login.token,
        account: login.account,
        accessCookie: getAccessCookieHeader(login.domain),
        trustedHost: isTrusted(login.domain),
    };
}
