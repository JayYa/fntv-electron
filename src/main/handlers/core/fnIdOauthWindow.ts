import { BrowserWindow, IpcMainEvent } from 'electron';
import { getMainWindow } from '../../common/mainwin';
import { ApiService } from '../../../modules/fn_api/api';
import { restoreCookies } from '../../../modules/fn_config/cookie';
import * as fnConfig from '../../../modules/fn_config/config';
import * as log from '../../../modules/logger';
import { applyVerifiedOriginToFnConnectBaseUrl, resolveFnConnectBaseUrl } from './fnConnect';
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
import {
    AccessCodeVerificationError,
    establishAccessCodeSession,
} from '../../common/accessCodeSession';
import { createFnIdMessageHandler } from './fnIdOauthMessages';
import { getAccessCodeInjectionScript, getInjectionScript, getLoginAutofillScript } from './fnIdScripts';

interface LoginData {
    domain: string;
    username: string;
    password: string;
    accessCode?: string;
    useHttps?: boolean;
}

/**
 * 构建 FN Connect URL
 * FN ID 归一化为 https://5ddd.com/{fnid}
 */
function buildFnConnectUrl(fnId: string): string {
    return `https://5ddd.com/${fnId.trim()}`;
}

/**
 * 处理 FN ID OAuth 登录流程
 */
export async function handleFnIdLogin(event: IpcMainEvent, loginData: LoginData): Promise<void> {
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
        // 创建 OAuth 登录窗口
        oauthWindow = new BrowserWindow({
            width: 800,
            height: 600,
            show: false, // Wait for ready-to-show
            title: 'FN ID 登录',
            autoHideMenuBar: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                // 每次登录使用临时隔离会话，避免旧 token 被误判为本次登录结果。
                partition: `fnid-oauth-${Date.now()}`,
            }
        });

        // 平滑显示
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
            // FN Connect 用隐藏 iframe 探测 NAS 地址，子框架的跳转不算窗口导航。
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

        async function establishTargetSession(targetBaseUrl: string): Promise<string> {
            if (!accessCode) return targetBaseUrl;
            const result = await establishAccessCodeSession(targetBaseUrl, accessCode);
            return applyVerifiedOriginToFnConnectBaseUrl(targetBaseUrl, result.baseUrl);
        }

        // 为 FN Connect 域名设置 mode=relay Cookie
        await oauthSession.cookies.set({
            url: fnConnectUrl,
            name: 'mode',
            value: 'relay',
            path: '/',
            secure: true,
        });

        // 注册 JS bridge 用于 WebView 与主进程通信
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

        // 创建一个 Promise 来等待登录完成
        const loginPromise = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('FN ID 登录超时（120秒）'));
            }, 120000);

            async function completeLogin(token: string, targetBaseUrl: string): Promise<void> {
                if (loginCompleted) return;
                loginCompleted = true;

                try {
                    const resolvedTargetBaseUrl = await establishTargetSession(targetBaseUrl);
                    const restored = await restoreCookies(resolvedTargetBaseUrl, token, true);
                    if (!restored) throw new Error('无法恢复 FN Connect 登录状态');

                    fnConfig.saveConfig({
                        account: loginData.username,
                        domain: resolvedTargetBaseUrl,
                        token,
                        accessCode,
                        useHttps: resolvedTargetBaseUrl.startsWith('https://'),
                    });
                    fnConfig.addHistory({
                        domain: fnId,
                        account: loginData.username,
                        password: loginData.password,
                        accessCode,
                        useHttps: true,
                    });

                    const mainWindow = getMainWindow();
                    log.info('[FN ID] 登录成功，跳转到主页面');
                    await mainWindow.loadURL(`${resolvedTargetBaseUrl}/v`);

                    clearTimeout(timeout);
                    resolve();
                } catch (error) {
                    loginCompleted = false;
                    reject(error);
                }
            }

            // 只记 Cookie 的域，不记值。登录走不通时靠这行判断是不是误拒。
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

                    const targetBaseUrl = await establishTargetSession(
                        resolveFnConnectBaseUrl(currentUrl, fnConnectUrl),
                    );
                    const verification = await new ApiService(targetBaseUrl, tokenCookie.value).getUserInfo(5000, 0);
                    if (!verification?.success) {
                        log.info('[FN ID] 当前 Cookie 不是可用的媒体 token，继续 OAuth 流程');
                        return;
                    }

                    log.info(`[FN ID] 检测到有效登录 Cookie，使用当前连接完成登录: ${targetBaseUrl}`);
                    authRequested = true;
                    await completeLogin(tokenCookie.value, targetBaseUrl);
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

            // NAS 报告的 OAuth 地址不可用时，留在当前页面的 origin。
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

            // 监听 console 消息（JS bridge）
            oauthWindow!.webContents.on('console-message', (details) => {
                const { frame, message } = details;
                if (message.startsWith('__FNTV_BRIDGE__:')) {
                    // 任何页面都能打印这个前缀，只听 NAS 页面的主框架。
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

            // 窗口关闭时取消登录
            oauthWindow!.on('closed', () => {
                oauthWindow = null;
                clearTimeout(timeout);
                if (!authRequested && !loginCompleted) {
                    reject(new Error('用户关闭了登录窗口'));
                }
            });
        });

        // 加载 FN Connect URL
        oauthWindow.loadURL(fnConnectUrl);

        // 等待登录完成
        await loginPromise;

        // 关闭 OAuth 窗口
        if (oauthWindow && !oauthWindow.isDestroyed()) {
            oauthWindow.close();
        }

    } catch (error: any) {
        const isAccessCodeError = error instanceof AccessCodeVerificationError;
        log.error('[FN ID] 登录失败:', isAccessCodeError ? error.reason : error);

        // 关闭 OAuth 窗口
        if (oauthWindow && !oauthWindow.isDestroyed()) {
            oauthWindow.close();
        }

        event.reply('login-error', {
            title: isAccessCodeError && error.reason === 'rejected' ? '访问码错误' : 'FN ID 登录失败',
            message: isAccessCodeError
                ? (error.reason === 'rejected'
                    ? '访问码错误，请检查后重试。'
                    : '无法连接到访问码验证服务，请检查地址、证书或网络连接。')
                : error.message || '通过 FN ID 登录时发生错误，请检查 FN ID 和网络连接。'
        });
    }
}
