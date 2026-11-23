import { BrowserWindow } from 'electron';
import { getMainWindow } from '../../common/mainwin';
import { ApiService } from '../../../modules/fn_api/api';
import * as log from '../../../modules/logger';
import { establishNewLogin, GrantedBaseUrl, LoginFailedError, type LoginReply, verifyAccess } from '../../common/currentLogin';
import { resolveFnConnectBaseUrl } from './fnConnect';
import {
    createFnIdTrust,
    describeFnIdPageForLog,
    isFnIdLoginPage,
    isFnIdNasPage,
    isFnIdTokenCookie,
    resolveFnIdNavigation,
    resolveFnIdOauthTrust,
    resolveFnIdWindowOpen,
} from './fnIdTrust';
import { createFnIdMessageHandler } from './fnIdOauthMessages';
import { getAccessCodeInjectionScript, getInjectionScript, getLoginAutofillScript } from './fnIdScripts';

interface LoginData {
    domain: string;
    username: string;
    password: string;
    accessCode?: string;
    useHttps?: boolean;
}

function buildFnConnectUrl(fnId: string): string {
    return `https://5ddd.com/${fnId.trim()}`;
}

export async function handleFnIdLogin(loginData: LoginData): Promise<LoginReply> {
    const fnId = loginData.domain.trim();
    const fnConnectUrl = buildFnConnectUrl(fnId);
    const accessCode = loginData.accessCode?.trim() || '';
    log.info('[FN ID] 开始 FN ID 登录');

    let oauthWindow: BrowserWindow | null = null;
    let authRequested = false;
    let loginCompleted = false;
    let cookieCheckInProgress = false;
    let trust = createFnIdTrust(fnConnectUrl);

    try {
        oauthWindow = new BrowserWindow({
            width: 800,
            height: 600,
            show: false,
            title: 'FN ID 登录',
            autoHideMenuBar: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                partition: `fnid-oauth-${Date.now()}`,
            }
        });

        oauthWindow.once('ready-to-show', () => {
            oauthWindow?.show();
        });

        const oauthSession = oauthWindow.webContents.session;

        function guardNavigation(event: { url: string; preventDefault(): void }): void {
            const next = resolveFnIdNavigation(event.url, trust);
            if (next) {
                trust = next;
                return;
            }
            event.preventDefault();
            log.warn('[FN ID] 已阻止 OAuth 窗口跳转到预期范围之外的地址');
        }

        oauthWindow.webContents.on('will-navigate', guardNavigation);
        oauthWindow.webContents.on('will-redirect', (event) => {
            if (event.isMainFrame) guardNavigation(event);
        });
        oauthWindow.webContents.setWindowOpenHandler(({ url }) => {
            const next = resolveFnIdWindowOpen(url, oauthWindow?.webContents.getURL() ?? '', trust);
            if (next) {
                trust = next;
                oauthWindow?.loadURL(url);
            } else {
                log.warn('[FN ID] 已拒绝 OAuth 窗口的弹窗');
            }
            return { action: 'deny' };
        });

        function establishTargetSession(targetBaseUrl: string): Promise<GrantedBaseUrl> {
            return verifyAccess(targetBaseUrl, accessCode);
        }

        await oauthSession.cookies.set({
            url: fnConnectUrl,
            name: 'mode',
            value: 'relay',
            path: '/',
            secure: true,
        });

        oauthWindow.webContents.on('did-finish-load', async () => {
            if (!oauthWindow) return;
            const pageUrl = oauthWindow.webContents.getURL();
            log.info(
                `[FN ID] 页面加载: ${describeFnIdPageForLog(pageUrl, fnId)}，NAS 页面: ${isFnIdNasPage(pageUrl, trust)}，`
                + `登录页: ${isFnIdLoginPage(pageUrl, trust)}，已确认目标: ${trust.targetOrigin !== null}，`
                + `有密码: ${Boolean(loginData.password)}`,
            );
            if (!isFnIdNasPage(pageUrl, trust)) return;
            try {
                const isAccessCodePage = accessCode
                    ? await oauthWindow.webContents.executeJavaScript(
                        `(() => {
                            const input = document.querySelector('#access-code-input, input[name="access-code"]');
                            const title = document.querySelector('#page-title');
                            return Boolean(input && input.closest('form') && title && title.textContent.trim() === '请输入访问码');
                        })()`,
                    )
                    : false;
                if (isAccessCodePage) {
                    await oauthWindow.webContents
                        .executeJavaScript(getAccessCodeInjectionScript(accessCode, pageUrl))
                        .catch(() => {
                            log.error('[FN ID] 访问码页面自动提交失败');
                        });
                    return;
                }

                await oauthWindow.webContents.executeJavaScript(`
                    window.__fntvBridge = function(msg) {
                        console.log('__FNTV_BRIDGE__:' + msg);
                    };
                    ${getInjectionScript()}
                `);
                if (isFnIdLoginPage(pageUrl, trust)) {
                    await oauthWindow.webContents.executeJavaScript(
                        getLoginAutofillScript(loginData.username, loginData.password, pageUrl),
                    );
                }
            } catch (err) {
                log.error('[FN ID] JS 注入失败:', err);
            }
        });

        const loginPromise = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('FN ID 登录超时（120秒）'));
            }, 120000);

            async function completeLogin(token: string, target: GrantedBaseUrl): Promise<void> {
                if (loginCompleted) return;
                loginCompleted = true;

                try {
                    const result = await establishNewLogin(getMainWindow, {
                        access: target,
                        account: loginData.username,
                        token,
                        history: {
                            domain: fnId,
                            account: loginData.username,
                            password: loginData.password,
                            accessCode,
                            useHttps: true,
                        },
                    });
                    if (!result.ok) throw new LoginFailedError(result.reason, result.error);
                    log.info('[FN ID] 登录成功，跳转到主页面');

                    clearTimeout(timeout);
                    resolve();
                } catch (error) {
                    loginCompleted = false;
                    reject(error);
                }
            }

            function logIgnoredTokenCookies(domains: Array<string | undefined>): void {
                log.info(
                    `[FN ID] 忽略目标范围外的登录 Cookie，Cookie 域: ${domains.join(', ')}，`
                    + `已确认目标: ${trust.targetOrigin !== null}`,
                );
            }

            async function tryCompleteFromSession(): Promise<void> {
                if (loginCompleted || authRequested || cookieCheckInProgress || !oauthWindow || oauthWindow.isDestroyed()) return;
                cookieCheckInProgress = true;

                try {
                    const currentUrl = oauthWindow.webContents.getURL();
                    if (!isFnIdNasPage(currentUrl, trust)) return;

                    const cookies = await oauthSession.cookies.get({ name: 'Trim-MC-token' });
                    const candidates = cookies.filter((cookie) => cookie.value.length > 0);
                    const tokenCookie = candidates.find((cookie) => isFnIdTokenCookie(cookie, trust));
                    if (!tokenCookie) {
                        if (candidates.length > 0) {
                            logIgnoredTokenCookies(candidates.map((cookie) => cookie.domain));
                        }
                        return;
                    }

                    const target = await establishTargetSession(
                        resolveFnConnectBaseUrl(currentUrl, fnConnectUrl),
                    );
                    const targetBaseUrl = target.baseUrl;
                    const verification = await new ApiService(targetBaseUrl, tokenCookie.value).getUserInfo(5000, 0);
                    if (!verification?.success) {
                        log.info('[FN ID] 当前 Cookie 不是可用的媒体 token，继续 OAuth 流程');
                        return;
                    }

                    log.info('[FN ID] 检测到有效登录 Cookie，使用当前连接完成登录');
                    authRequested = true;
                    await completeLogin(tokenCookie.value, target);
                } finally {
                    cookieCheckInProgress = false;
                }
            }

            oauthWindow!.webContents.on('did-finish-load', () => {
                setTimeout(() => {
                    tryCompleteFromSession().catch((error: unknown) => {
                        log.error('[FN ID] 检查登录 Cookie 失败:', error);
                    });
                }, 300);
            });

            oauthSession.cookies.on('changed', (_event, cookie, _cause, removed) => {
                if (removed || cookie.name !== 'Trim-MC-token' || !cookie.value) return;
                if (!isFnIdTokenCookie(cookie, trust)) {
                    logIgnoredTokenCookies([cookie.domain]);
                    return;
                }
                tryCompleteFromSession().catch((error: unknown) => {
                    log.error('[FN ID] Cookie 变更处理失败:', error);
                });
            });

            function adoptOauthBaseUrl(reportedUrl: string, pageOrigin: string): string {
                if (!reportedUrl || reportedUrl === '://') return pageOrigin;
                const next = resolveFnIdOauthTrust(reportedUrl, trust);
                if (!next) {
                    log.warn('[FN ID] 忽略 NAS 报告的 OAuth 地址，继续使用当前页面地址');
                    return pageOrigin;
                }
                trust = next;
                return reportedUrl;
            }

            const handleMessage = createFnIdMessageHandler({
                get oauthWindow() { return oauthWindow; },
                get authRequested() { return authRequested; },
                set authRequested(value) { authRequested = value; },
                oauthSession,
                establishTargetSession,
                completeLogin,
                adoptOauthBaseUrl,
                reject,
            });

            oauthWindow!.webContents.on('console-message', (details) => {
                const { frame, message } = details;
                if (message.startsWith('__FNTV_BRIDGE__:')) {
                    const webContents = oauthWindow?.webContents;
                    if (!webContents || frame !== webContents.mainFrame) return;
                    if (!isFnIdNasPage(webContents.getURL(), trust)) return;

                    const jsonStr = message.substring('__FNTV_BRIDGE__:'.length);
                    try {
                        const data = JSON.parse(jsonStr);
                        handleMessage(data);
                    } catch (err) {
                        log.error('[FN ID] 解析 bridge 消息失败:', err);
                    }
                }
            });

            oauthWindow!.on('closed', () => {
                oauthWindow = null;
                clearTimeout(timeout);
                if (!authRequested && !loginCompleted) {
                    reject(new Error('用户关闭了登录窗口'));
                }
            });
        });

        oauthWindow.loadURL(fnConnectUrl);

        await loginPromise;

        if (oauthWindow && !oauthWindow.isDestroyed()) {
            oauthWindow.close();
        }

        return { ok: true };
    } catch (error: any) {
        const isLoginError = error instanceof LoginFailedError;
        log.error('[FN ID] 登录失败:', isLoginError ? error.reason : error);

        if (oauthWindow && !oauthWindow.isDestroyed()) {
            oauthWindow.close();
        }

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
    }
}
