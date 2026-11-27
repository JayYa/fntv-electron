import { BrowserWindow, Session } from 'electron';
import { mainWindow } from '../../common/mainWindow';
import { ApiService } from '../../../modules/fn_api/api';
import * as log from '../../../modules/logger';
import { establishNewLogin, GrantedBaseUrl, LoginFailedError, type LoginReply, verifyAccess } from '../../common/currentLogin';
import { resolveFnConnectBaseUrl } from './fnConnect';
import {
    createFnIdTrust,
    describeFnIdPageForLog,
    type FnIdTrust,
    isFnIdLoginPage,
    isFnIdNasPage,
    isFnIdTokenCookie,
    resolveFnIdNavigation,
    resolveFnIdOauthTrust,
    resolveFnIdWindowOpen,
} from './fnIdTrust';
import { FnIdOauthHandshake } from './fnIdOauthHandshake';
import { getAccessCodeInjectionScript, getInjectionScript, getLoginAutofillScript } from './fnIdScripts';

export interface FnIdLoginData {
    domain: string;
    username: string;
    password: string;
    accessCode?: string;
}

const LOGIN_TIMEOUT_MS = 120000;
const SESSION_COOKIE_CHECK_DELAY_MS = 300;
const TOKEN_COOKIE = 'Trim-MC-token';
const BRIDGE_PREFIX = '__FNTV_BRIDGE__:';

const LOGIN_IN_PROGRESS: LoginReply = {
    ok: false,
    error: { title: 'FN ID 登录进行中', message: '请先在已打开的 FN Connect 窗口中完成或取消登录。' },
};

let loginInProgress = false;

export async function handleFnIdLogin(loginData: FnIdLoginData): Promise<LoginReply> {
    if (loginInProgress) return LOGIN_IN_PROGRESS;
    loginInProgress = true;
    try {
        return await runFnIdLogin(loginData);
    } finally {
        loginInProgress = false;
    }
}

async function runFnIdLogin(loginData: FnIdLoginData): Promise<LoginReply> {
    log.info('[FN ID] 开始 FN ID 登录');
    let login: FnIdLogin | null = null;
    try {
        login = new FnIdLogin(loginData);
        await login.run();
        return { ok: true };
    } catch (error: any) {
        const isLoginError = error instanceof LoginFailedError;
        log.error('[FN ID] 登录失败:', isLoginError ? error.reason : error);
        if (isLoginError) {
            return { ok: false, error: error.loginError };
        }
        return {
            ok: false,
            error: {
                title: 'FN ID 登录失败',
                message: error.message || '通过 FN ID 登录时发生错误，请检查 FN ID 和网络连接。',
            },
        };
    } finally {
        login?.closeWindow();
    }
}

type Phase = 'open' | 'completing' | 'settled';

class FnIdLogin {
    private readonly fnId: string;
    private readonly fnConnectUrl: string;
    private readonly accessCode: string;
    private readonly window: BrowserWindow;
    private readonly session: Session;
    private readonly handshake: FnIdOauthHandshake;
    private trust: FnIdTrust;
    private phase: Phase = 'open';
    private sessionCookieCheckInProgress = false;
    private resolve!: () => void;
    private reject!: (reason: unknown) => void;

    constructor(private readonly loginData: FnIdLoginData) {
        this.fnId = loginData.domain.trim();
        this.fnConnectUrl = `https://5ddd.com/${this.fnId}`;
        this.accessCode = loginData.accessCode?.trim() || '';
        this.trust = createFnIdTrust(this.fnConnectUrl);
        this.window = new BrowserWindow({
            width: 800,
            height: 600,
            show: false,
            title: 'FN ID 登录',
            autoHideMenuBar: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                partition: `fnid-oauth-${Date.now()}`,
            },
        });
        this.session = this.window.webContents.session;
        this.handshake = new FnIdOauthHandshake(this.window, this.accessCode, (reported, origin) => this.adoptOauthBaseUrl(reported, origin));
    }

    async run(): Promise<void> {
        const outcome = new Promise<void>((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
        outcome.catch(() => {});
        const timeout = setTimeout(() => this.fail(new Error(`FN ID 登录超时（${LOGIN_TIMEOUT_MS / 1000}秒）`)), LOGIN_TIMEOUT_MS);
        try {
            this.guardNavigation();
            await this.session.cookies.set({ url: this.fnConnectUrl, name: 'mode', value: 'relay', path: '/', secure: true });
            this.listenForCompletion();
            this.window.loadURL(this.fnConnectUrl);
            await outcome;
        } finally {
            clearTimeout(timeout);
            this.phase = 'settled';
        }
    }

    closeWindow(): void {
        if (!this.window.isDestroyed()) this.window.close();
    }

    private claimCompletion(): boolean {
        if (this.phase !== 'open') return false;
        this.phase = 'completing';
        return true;
    }

    private fail(error: unknown): void {
        if (this.phase === 'settled') return;
        this.phase = 'settled';
        this.reject(error);
    }

    private async complete(token: string, target: GrantedBaseUrl): Promise<void> {
        try {
            const result = await establishNewLogin(mainWindow.window, {
                access: target,
                account: this.loginData.username,
                token,
                history: {
                    domain: this.fnId,
                    account: this.loginData.username,
                    password: this.loginData.password,
                    accessCode: this.accessCode,
                    useHttps: true,
                },
            });
            if (!result.ok) throw new LoginFailedError(result.reason, result.error);
            log.info('[FN ID] 登录成功，跳转到主页面');
            if (this.phase === 'settled') return;
            this.phase = 'settled';
            this.resolve();
        } catch (error) {
            this.fail(error);
        }
    }

    private guardNavigation(): void {
        const webContents = this.window.webContents;
        const guard = (event: { url: string; preventDefault(): void }): void => {
            const next = resolveFnIdNavigation(event.url, this.trust);
            if (next) {
                this.trust = next;
                return;
            }
            event.preventDefault();
            log.warn('[FN ID] 已阻止 OAuth 窗口跳转到预期范围之外的地址');
        };
        this.window.once('ready-to-show', () => this.window.show());
        webContents.on('will-navigate', guard);
        webContents.on('will-redirect', (event) => {
            if (event.isMainFrame) guard(event);
        });
        webContents.setWindowOpenHandler(({ url }) => {
            const next = resolveFnIdWindowOpen(url, webContents.getURL(), this.trust);
            if (next) {
                this.trust = next;
                this.window.loadURL(url);
            } else {
                log.warn('[FN ID] 已拒绝 OAuth 窗口的弹窗');
            }
            return { action: 'deny' };
        });
    }

    private listenForCompletion(): void {
        const webContents = this.window.webContents;
        webContents.on('did-finish-load', () => {
            void this.injectScripts();
            setTimeout(() => {
                this.completeFromSessionCookie().catch((error: unknown) => {
                    log.error('[FN ID] 检查登录 Cookie 失败:', error);
                });
            }, SESSION_COOKIE_CHECK_DELAY_MS);
        });
        this.session.cookies.on('changed', (_event, cookie, _cause, removed) => {
            if (removed || cookie.name !== TOKEN_COOKIE || !cookie.value) return;
            if (!isFnIdTokenCookie(cookie, this.trust)) {
                this.logIgnoredTokenCookies([cookie.domain]);
                return;
            }
            this.completeFromSessionCookie().catch((error: unknown) => {
                log.error('[FN ID] Cookie 变更处理失败:', error);
            });
        });
        webContents.on('console-message', ({ frame, message }) => {
            if (!message.startsWith(BRIDGE_PREFIX)) return;
            if (this.window.isDestroyed() || frame !== webContents.mainFrame) return;
            if (!isFnIdNasPage(webContents.getURL(), this.trust)) return;
            let data: unknown;
            try {
                data = JSON.parse(message.substring(BRIDGE_PREFIX.length));
            } catch (err) {
                log.error('[FN ID] 解析 bridge 消息失败:', err);
                return;
            }
            void this.completeFromBridgeMessage(data);
        });
        this.window.on('closed', () => {
            if (this.phase === 'open') this.fail(new Error('用户关闭了登录窗口'));
        });
    }

    private async injectScripts(): Promise<void> {
        if (this.window.isDestroyed()) return;
        const webContents = this.window.webContents;
        const pageUrl = webContents.getURL();
        log.info(
            `[FN ID] 页面加载: ${describeFnIdPageForLog(pageUrl, this.fnId)}，NAS 页面: ${isFnIdNasPage(pageUrl, this.trust)}，`
            + `登录页: ${isFnIdLoginPage(pageUrl, this.trust)}，已确认目标: ${this.trust.targetOrigin !== null}，`
            + `有密码: ${Boolean(this.loginData.password)}`,
        );
        if (!isFnIdNasPage(pageUrl, this.trust)) return;
        try {
            const isAccessCodePage = this.accessCode
                ? await webContents.executeJavaScript(
                    `(() => {
                        const input = document.querySelector('#access-code-input, input[name="access-code"]');
                        const title = document.querySelector('#page-title');
                        return Boolean(input && input.closest('form') && title && title.textContent.trim() === '请输入访问码');
                    })()`,
                )
                : false;
            if (isAccessCodePage) {
                await webContents
                    .executeJavaScript(getAccessCodeInjectionScript(this.accessCode, pageUrl))
                    .catch(() => {
                        log.error('[FN ID] 访问码页面自动提交失败');
                    });
                return;
            }

            await webContents.executeJavaScript(`
                window.__fntvBridge = function(msg) {
                    console.log('${BRIDGE_PREFIX}' + msg);
                };
                ${getInjectionScript()}
            `);
            if (isFnIdLoginPage(pageUrl, this.trust)) {
                await webContents.executeJavaScript(
                    getLoginAutofillScript(this.loginData.username, this.loginData.password, pageUrl),
                );
            }
        } catch (err) {
            log.error('[FN ID] JS 注入失败:', err);
        }
    }

    private async completeFromBridgeMessage(message: unknown): Promise<void> {
        const code = await this.handshake.takeAuthorizationCode(message);
        if (!code || !this.claimCompletion()) return;
        log.info('[FN ID] 获取到授权码，开始换取 token');
        const issued = await this.handshake.exchangeCode(code).catch((err: unknown) => {
            this.fail(err);
            return null;
        });
        if (issued) await this.complete(issued.token, issued.target);
    }

    private async completeFromSessionCookie(): Promise<void> {
        if (this.phase !== 'open' || this.sessionCookieCheckInProgress || this.window.isDestroyed()) return;
        this.sessionCookieCheckInProgress = true;
        try {
            const currentUrl = this.window.webContents.getURL();
            if (!isFnIdNasPage(currentUrl, this.trust)) return;

            const cookies = await this.session.cookies.get({ name: TOKEN_COOKIE });
            const candidates = cookies.filter((cookie) => cookie.value.length > 0);
            const tokenCookie = candidates.find((cookie) => isFnIdTokenCookie(cookie, this.trust));
            if (!tokenCookie) {
                if (candidates.length > 0) this.logIgnoredTokenCookies(candidates.map((cookie) => cookie.domain));
                return;
            }

            const target = await verifyAccess(resolveFnConnectBaseUrl(currentUrl, this.fnConnectUrl), this.accessCode);
            if (!await new ApiService(target.baseUrl, tokenCookie.value).tokenAccepted()) {
                log.info('[FN ID] 当前 Cookie 不是可用的媒体 token，继续 OAuth 流程');
                return;
            }
            if (!this.claimCompletion()) return;
            log.info('[FN ID] 检测到有效登录 Cookie，使用当前连接完成登录');
            await this.complete(tokenCookie.value, target);
        } finally {
            this.sessionCookieCheckInProgress = false;
        }
    }

    private adoptOauthBaseUrl(reportedUrl: string, pageOrigin: string): string {
        if (!reportedUrl || reportedUrl === '://') return pageOrigin;
        const next = resolveFnIdOauthTrust(reportedUrl, this.trust);
        if (!next) {
            log.warn('[FN ID] 忽略 NAS 报告的 OAuth 地址，继续使用当前页面地址');
            return pageOrigin;
        }
        this.trust = next;
        return reportedUrl;
    }

    private logIgnoredTokenCookies(domains: Array<string | undefined>): void {
        log.info(
            `[FN ID] 忽略目标范围外的登录 Cookie，Cookie 域: ${domains.join(', ')}，`
            + `已确认目标: ${this.trust.targetOrigin !== null}`,
        );
    }
}
