import { session } from 'electron';
import { clearAccessGrants } from '../../modules/fn_api/accessGrant';
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

export type LoginFailureReason =
    | 'access-code-rejected'
    | 'access-code-unreachable'
    | 'token-not-issued'
    | 'session-not-restored'
    | 'secure-storage'
    | 'unexpected';

export type LoginResult = { ok: true } | { ok: false; reason: LoginFailureReason; error: LoginError };

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

// 每次验证访问码和结束当前登录都会清空访问授权，代数随之加一。
let grantGeneration = 0;

function accessCodeFailure(error: AccessCodeVerificationError): LoginFailedError {
    return error.reason === 'rejected'
        ? new LoginFailedError('access-code-rejected', { title: '访问码错误', message: '访问码错误，请检查后重试。' })
        : new LoginFailedError('access-code-unreachable', {
            title: '连接失败',
            message: '无法连接到访问码验证服务，请检查地址、证书或网络连接。',
        });
}

/**
 * 访问码验证通过后的 NAS 地址，只能由 verifyAccess 得到。访问授权本身留在 accessGrant 里；
 * 这里记着访问码，是为了授权被清空后能重新验证，并在保存当前登录时写入。
 */
export class GrantedBaseUrl {
    private constructor(
        readonly baseUrl: string,
        readonly accessCode: string,
        private readonly generation: number,
    ) {}

    static async verify(baseUrl: string, accessCode: string): Promise<GrantedBaseUrl> {
        const generation = ++grantGeneration;
        try {
            const session = await establishAccessCodeSession(baseUrl, accessCode);
            return new GrantedBaseUrl(applyVerifiedOriginToFnConnectBaseUrl(baseUrl, session.baseUrl), accessCode, generation);
        } catch (error) {
            if (!(error instanceof AccessCodeVerificationError)) throw error;
            log.warn('访问码验证失败:', error.reason);
            throw accessCodeFailure(error);
        }
    }

    /** 之后又有验证或结束当前登录清空过授权时，重新验证一次。 */
    current(): Promise<GrantedBaseUrl> {
        return this.generation === grantGeneration
            ? Promise.resolve(this)
            : GrantedBaseUrl.verify(this.baseUrl, this.accessCode);
    }
}

/** 验证访问码，失败时抛出 LoginFailedError。 */
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

/** 还没验证访问码的地址，或 verifyAccess 已经验证过的地址。 */
export type LoginAccess = GrantedBaseUrl | { baseUrl: string; accessCode: string };

interface LoginSteps {
    access: LoginAccess;
    account: string;
    token(baseUrl: string): Promise<IssuedToken>;
    isNewLogin: boolean;
    history?: fnConfig.AddHistoryParams;
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

        if (!await restoreCookies(baseUrl, token, isNewLogin)) {
            return fail('session-not-restored', { title: '登录失败', message: '无法恢复登录状态，请重新登录。' });
        }

        if (isNewLogin || baseUrl !== access.baseUrl) {
            await fnConfig.saveConfig({
                account: steps.account,
                domain: baseUrl,
                token,
                accessCode: granted.accessCode,
                useHttps: baseUrl.startsWith('https://'),
            });
        }
        if (steps.history) {
            await fnConfig.addHistory(steps.history);
        }

        log.info('已建立当前登录，进入网页端, domain:', baseUrl);
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
    /** 已经拿到的 token，或用验证后的地址换取 token。 */
    token: string | ((baseUrl: string) => Promise<IssuedToken>);
    history: fnConfig.AddHistoryParams;
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

export interface SavedLogin {
    baseUrl: string;
    accessCode: string;
    account: string;
    savedToken: string;
}

const END_LOGIN_TIMEOUT_MS = 5000;

/** 清空 token、访问授权和会话 Cookie，再显示登录页；清理最多等 5 秒，失败只记日志。 */
export async function endCurrentLogin(window: LoginWindow): Promise<void> {
    log.info('结束当前登录，清空 token、访问授权和 Cookie');
    grantGeneration++;
    clearAccessGrants();
    const clearing = Promise.all([
        fnConfig.clearSavedToken().then(
            (cleared) => { if (cleared) log.info('已清空配置中的登录 token'); },
            (error: unknown) => { log.error('清空配置中的登录 token 失败:', error); },
        ),
        session.fromPartition('persist:fntv').clearStorageData({ storages: ['cookies'] }).then(
            () => { log.info('会话 Cookie 已清除'); },
            (error: unknown) => { log.error('清除会话 Cookie 失败:', error); },
        ),
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

export function restoreCurrentLogin(windowForWebUi: () => LoginWindow, saved: SavedLogin): Promise<LoginResult> {
    return establish(windowForWebUi, {
        access: { baseUrl: saved.baseUrl, accessCode: saved.accessCode },
        account: saved.account,
        token: async () => ({ token: saved.savedToken }),
        isNewLogin: false,
    });
}
