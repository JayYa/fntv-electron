import { BrowserWindow, Session } from 'electron';
import { ApiService } from '../../../modules/fn_api/api';
import { request, HttpMethod } from '../../../modules/fn_api/request';
import * as log from '../../../modules/logger';
import type { GrantedBaseUrl } from '../../common/currentLogin';

export interface FnIdOauthFlow {
    readonly oauthWindow: BrowserWindow | null;
    authRequested: boolean;
    oauthSession: Session;
    establishTargetSession(targetBaseUrl: string): Promise<GrantedBaseUrl>;
    completeLogin(token: string, target: GrantedBaseUrl): Promise<void>;
    adoptOauthBaseUrl(reportedUrl: string, pageOrigin: string): string;
    reject(reason: unknown): void;
}

export function createFnIdMessageHandler(flow: FnIdOauthFlow): (messageData: any) => Promise<void> {
    const { oauthSession, establishTargetSession, completeLogin, adoptOauthBaseUrl, reject } = flow;
    let baseUrl = '';
    let cookieString = '';
    let sysConfigLoaded = false;

    async function handleMessage(messageData: any) {
        try {
            const type = messageData.type;
            const url = messageData.url || '';

            if (type === 'XHR' && url.includes('/sac/rpcproxy/v1/new-user-guide/status')) {
                const cookie = messageData.cookie;
                if (cookie) {
                    cookieString = cookie;
                    log.info('[FN ID] 获取到 Cookie');

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

            if (type === 'SysConfig') {
                if (sysConfigLoaded && baseUrl) return;
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

                    baseUrl = adoptOauthBaseUrl(data.nas_oauth.url || '', pageOrigin);

                    if (baseUrl && appId) {
                        sysConfigLoaded = true;
                        const redirectUri = `${baseUrl}/v/oauth/result`;
                        const targetUrl = `${baseUrl}/signin?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}`;
                        log.info('[FN ID] 跳转到 OAuth 授权页面');

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

            if (type === 'Response' && url.includes('/oauthapi/authorize')) {
                if (flow.authRequested) return;

                const code = messageData.code || authorizationCodeFromBody(messageData.body);

                if (code) {
                    flow.authRequested = true;
                    log.info('[FN ID] 获取到授权码，开始换取 token');

                    try {
                        const target = await establishTargetSession(baseUrl);
                        baseUrl = target.baseUrl;
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

                        await completeLogin(token, target);
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

    async function handleSysConfig(cookie: string) {
        if (baseUrl && sysConfigLoaded) return;

        const currentUrl = flow.oauthWindow?.webContents.getURL() || '';
        if (!currentUrl) return;

        const parsed = new URL(currentUrl);
        const currentBaseUrl = `${parsed.protocol}//${parsed.host}`;

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

function authorizationCodeFromBody(body: unknown): string | undefined {
    if (typeof body !== 'string' || !body) return undefined;
    try {
        return JSON.parse(body).data?.code;
    } catch {
        return undefined;
    }
}
