import { BrowserWindow, Session } from 'electron';
import { ApiService } from '../../../modules/fn_api/api';
import { request, HttpMethod } from '../../../modules/fn_api/request';
import * as log from '../../../modules/logger';

/**
 * handleFnIdLogin 和消息处理共用的东西。oauthWindow 和 authRequested 两边都会读写当前值，
 * 所以按 flow.xxx 读取，不要解构。
 */
export interface FnIdOauthFlow {
    readonly oauthWindow: BrowserWindow | null;
    authRequested: boolean;
    oauthSession: Session;
    establishTargetSession(targetBaseUrl: string): Promise<string>;
    completeLogin(token: string, targetBaseUrl: string): Promise<void>;
    adoptOauthBaseUrl(reportedUrl: string, pageOrigin: string): string;
    reject(reason: unknown): void;
}

/**
 * 创建一次登录用的 bridge 消息处理函数。
 */
export function createFnIdMessageHandler(flow: FnIdOauthFlow): (messageData: any) => Promise<void> {
    const { oauthSession, establishTargetSession, completeLogin, adoptOauthBaseUrl, reject } = flow;
    let baseUrl = '';
    let cookieString = '';
    let sysConfigLoaded = false;

    // 处理从 WebView 收到的消息
    async function handleMessage(messageData: any) {
        try {
            const type = messageData.type;
            const url = messageData.url || '';

            // 处理 XHR 拦截（获取 Cookie）
            if (type === 'XHR' && url.includes('/sac/rpcproxy/v1/new-user-guide/status')) {
                const cookie = messageData.cookie;
                if (cookie) {
                    cookieString = cookie;
                    log.info('[FN ID] 获取到 Cookie');

                    // 获取 sysConfig
                    if (!sysConfigLoaded) {
                        sysConfigLoaded = true;
                        try {
                            await handleSysConfig(cookie);
                        } catch (err) {
                            log.error('[FN ID] 获取系统配置失败:', err);
                            sysConfigLoaded = false;
                        }
                    }
                }
            }

            // 处理 SysConfig 响应（来自 WebView 内部 fetch）
            if (type === 'SysConfig') {
                if (sysConfigLoaded && baseUrl) return; // 已处理过
                const body = messageData.body;
                if (!body) return;

                try {
                    if (typeof body !== 'string' || !body.trimStart().startsWith('{')) {
                        log.warn('[FN ID] sys/config 未返回 JSON，等待登录 Cookie 或 OAuth 回调');
                        return;
                    }
                    const bodyJson = JSON.parse(body);
                    const data = bodyJson.data;
                    if (!data || !data.nas_oauth) return;

                    const appId = data.nas_oauth.app_id;
                    const pageOrigin = new URL(flow.oauthWindow!.webContents.getURL()).origin;

                    // 确定 baseUrl
                    baseUrl = adoptOauthBaseUrl(data.nas_oauth.url || '', pageOrigin);

                    if (baseUrl && appId) {
                        sysConfigLoaded = true;
                        const redirectUri = `${baseUrl}/v/oauth/result`;
                        const targetUrl = `${baseUrl}/signin?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}`;
                        log.info('[FN ID] 跳转到 OAuth 授权页面');

                        // 转发 Cookie 到新域名
                        if (cookieString) {
                            const domain = baseUrl.replace(/^https?:\/\//, '').split(':')[0].split('/')[0];
                            const cookies = cookieString.split(';');
                            for (const c of cookies) {
                                const parts = c.trim().split('=');
                                if (parts.length >= 2) {
                                    await oauthSession.cookies.set({
                                        url: baseUrl,
                                        name: parts[0].trim(),
                                        value: parts.slice(1).join('=').trim(),
                                        path: '/',
                                        domain: domain,
                                    }).catch(() => { });
                                }
                            }
                            // 确保 mode=relay 被设置
                            await oauthSession.cookies.set({
                                url: baseUrl,
                                name: 'mode',
                                value: 'relay',
                                path: '/',
                            }).catch(() => { });
                        }

                        if (flow.oauthWindow) {
                            flow.oauthWindow.loadURL(targetUrl);
                        }
                    }
                } catch (err) {
                    log.error('[FN ID] 解析 SysConfig 失败:', err);
                }
            }

            // 处理 OAuth 授权码响应
            if (type === 'Response' && url.includes('/oauthapi/authorize')) {
                if (flow.authRequested) return;

                let code = messageData.code;
                if (!code && messageData.body) {
                    try {
                        const bodyJson = JSON.parse(messageData.body);
                        code = bodyJson.data?.code;
                    } catch {
                        // 响应体不是 JSON 时没有授权码，按未取到处理。
                    }
                }

                if (code) {
                    flow.authRequested = true;
                    log.info('[FN ID] 获取到授权码，开始换取 token');

                    try {
                        // 使用 baseUrl 创建 API 实例并换取 token
                        baseUrl = await establishTargetSession(baseUrl);
                        const fnapi = new ApiService(baseUrl);
                        const authResponse = await fnapi.auth(code);

                        if (!authResponse || !authResponse.success || !authResponse.data?.token) {
                            const msg = authResponse?.message || '换取 token 失败';

                            log.error(`[FN ID] ${baseUrl} 授权失败: ${msg}`);

                            flow.authRequested = false;
                            reject(new Error(msg));
                            return;
                        }

                        const token = authResponse.data.token;
                        log.info('[FN ID] 获取 token 成功');

                        await completeLogin(token, baseUrl);
                    } catch (err) {
                        flow.authRequested = false;
                        log.error('[FN ID] Token 交换失败:', err);
                        reject(err);
                    }
                }
            }
        } catch (err) {
            log.error('[FN ID] 消息处理错误:', err);
        }
    }

    // 通过 API 获取 sys_config（作为备选方案）
    async function handleSysConfig(cookie: string) {
        if (baseUrl && sysConfigLoaded) return;

        // 从当前 URL 获取 baseUrl
        const currentUrl = flow.oauthWindow?.webContents.getURL() || '';
        if (!currentUrl) return;

        const parsed = new URL(currentUrl);
        const currentBaseUrl = `${parsed.protocol}//${parsed.host}`;

        // 使用获取到的 Cookie，通过 API 获取 sys_config
        const extraHeaders: Record<string, string> = { 'Cookie': cookie + '; mode=relay' };

        const configResponse = await request(
            currentBaseUrl,
            '/v/api/v1/sys/config',
            HttpMethod.GET,
            '',
            undefined,
            extraHeaders
        );

        if (configResponse.success && configResponse.data) {
            const data = configResponse.data as any;
            const oauth = data.nas_oauth;
            if (oauth && oauth.app_id) {
                const targetBaseUrl = adoptOauthBaseUrl(oauth.url || '', currentBaseUrl);
                baseUrl = targetBaseUrl;

                const appId = oauth.app_id;
                const redirectUri = `${targetBaseUrl}/v/oauth/result`;
                const targetUrl = `${targetBaseUrl}/signin?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}`;
                log.info('[FN ID] 通过 API 获取 OAuth 配置，跳转到授权页面');

                // 转发 Cookie
                const domain = targetBaseUrl.replace(/^https?:\/\//, '').split(':')[0].split('/')[0];
                const cookies = cookie.split(';');
                for (const c of cookies) {
                    const parts = c.trim().split('=');
                    if (parts.length >= 2) {
                        await oauthSession.cookies.set({
                            url: targetBaseUrl,
                            name: parts[0].trim(),
                            value: parts.slice(1).join('=').trim(),
                            path: '/',
                            domain: domain,
                        }).catch(() => { });
                    }
                }
                await oauthSession.cookies.set({
                    url: targetBaseUrl,
                    name: 'mode',
                    value: 'relay',
                    path: '/',
                }).catch(() => { });

                if (flow.oauthWindow) {
                    flow.oauthWindow.loadURL(targetUrl);
                }
            }
        }
    }

    return handleMessage;
}
