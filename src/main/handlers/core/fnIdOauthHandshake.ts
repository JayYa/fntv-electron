import { BrowserWindow, CookiesSetDetails } from 'electron';
import { ApiService } from '../../../modules/fn_api/api';
import { request, HttpMethod } from '../../../modules/fn_api/request';
import * as log from '../../../modules/logger';
import { type GrantedBaseUrl, verifyAccess } from '../../common/currentLogin';

export interface IssuedFnIdToken {
    token: string;
    target: GrantedBaseUrl;
}

type AdoptOauthBaseUrl = (reportedUrl: string, pageOrigin: string) => string;

export class FnIdOauthHandshake {
    private oauthBaseUrl = '';
    private cookieString = '';
    private sysConfigLoaded = false;

    constructor(
        private readonly window: BrowserWindow,
        private readonly accessCode: string,
        private readonly adoptOauthBaseUrl: AdoptOauthBaseUrl,
    ) {}

    async takeAuthorizationCode(message: any): Promise<string | null> {
        try {
            const type = message.type;
            const url = message.url || '';
            if (type === 'XHR' && url.includes('/sac/rpcproxy/v1/new-user-guide/status')) {
                await this.onUserGuideStatus(message.cookie);
            }
            if (type === 'SysConfig') {
                await this.onSysConfig(message.body);
            }
            if (type === 'Response' && url.includes('/oauthapi/authorize')) {
                return message.code || authorizationCodeFromBody(message.body) || null;
            }
        } catch (err) {
            log.error('[FN ID] 消息处理错误:', err);
        }
        return null;
    }

    async exchangeCode(code: string): Promise<IssuedFnIdToken> {
        let target: GrantedBaseUrl;
        let authResponse: Awaited<ReturnType<ApiService['auth']>>;
        try {
            target = await verifyAccess(this.oauthBaseUrl, this.accessCode);
            this.oauthBaseUrl = target.baseUrl;
            authResponse = await new ApiService(target.baseUrl).auth(code);
        } catch (err) {
            log.error('[FN ID] Token 交换失败:', err);
            throw err;
        }
        if (!authResponse || !authResponse.success || !authResponse.data?.token) {
            const msg = authResponse?.message || '换取 token 失败';
            log.error(`[FN ID] 授权失败: ${msg}`);
            throw new Error(msg);
        }
        log.info('[FN ID] 获取 token 成功');
        return { token: authResponse.data.token, target };
    }

    private async onUserGuideStatus(cookie: string | undefined): Promise<void> {
        if (!cookie) return;
        this.cookieString = cookie;
        log.info('[FN ID] 获取到 Cookie');
        if (this.sysConfigLoaded) return;
        this.sysConfigLoaded = true;
        try {
            await this.requestSysConfig(cookie);
        } catch (err) {
            log.error('[FN ID] 获取系统配置失败:', err);
            this.sysConfigLoaded = false;
        }
    }

    private async onSysConfig(body: unknown): Promise<void> {
        if (this.sysConfigLoaded && this.oauthBaseUrl) return;
        if (!body) return;
        try {
            if (typeof body !== 'string' || !body.trimStart().startsWith('{')) {
                log.warn('[FN ID] sys/config 未返回 JSON，等待登录 Cookie 或 OAuth 回调');
                return;
            }
            const data = JSON.parse(body).data;
            if (!data || !data.nas_oauth) return;

            const appId = data.nas_oauth.app_id;
            const pageOrigin = new URL(this.window.webContents.getURL()).origin;
            this.oauthBaseUrl = this.adoptOauthBaseUrl(data.nas_oauth.url || '', pageOrigin);

            if (this.oauthBaseUrl && appId) {
                this.sysConfigLoaded = true;
                log.info('[FN ID] 跳转到 OAuth 授权页面');
                await this.redirectToOauth(appId, this.cookieString);
            }
        } catch (err) {
            log.error('[FN ID] 解析 SysConfig 失败:', err);
        }
    }

    private async requestSysConfig(cookie: string): Promise<void> {
        if (this.oauthBaseUrl && this.sysConfigLoaded) return;

        if (this.window.isDestroyed()) return;
        const currentUrl = this.window.webContents.getURL();
        if (!currentUrl) return;

        const parsed = new URL(currentUrl);
        const currentBaseUrl = `${parsed.protocol}//${parsed.host}`;
        const configResponse = await request(
            currentBaseUrl,
            '/v/api/v1/sys/config',
            HttpMethod.GET,
            '',
            undefined,
            { 'Cookie': cookie + '; mode=relay' },
        );

        const oauth = configResponse.success ? (configResponse.data as any)?.nas_oauth : undefined;
        if (oauth && oauth.app_id) {
            this.oauthBaseUrl = this.adoptOauthBaseUrl(oauth.url || '', currentBaseUrl);
            log.info('[FN ID] 通过 API 获取 OAuth 配置，跳转到授权页面');
            await this.redirectToOauth(oauth.app_id, cookie);
        }
    }

    private async redirectToOauth(appId: string, cookieHeader: string): Promise<void> {
        const targetBaseUrl = this.oauthBaseUrl;
        if (cookieHeader) {
            const domain = new URL(targetBaseUrl).hostname;
            for (const pair of cookieHeader.split(';')) {
                const parts = pair.trim().split('=');
                if (parts.length < 2) continue;
                await this.setCookie({ url: targetBaseUrl, name: parts[0].trim(), value: parts.slice(1).join('=').trim(), path: '/', domain });
            }
            await this.setCookie({ url: targetBaseUrl, name: 'mode', value: 'relay', path: '/' });
        }

        const redirectUri = `${targetBaseUrl}/v/oauth/result`;
        if (this.window.isDestroyed()) return;
        this.window.loadURL(`${targetBaseUrl}/signin?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}`);
    }

    private async setCookie(cookie: CookiesSetDetails): Promise<void> {
        try {
            await this.window.webContents.session.cookies.set(cookie);
        } catch (err) {
            log.warn(`[FN ID] 设置 Cookie ${cookie.name} 失败:`, err instanceof Error ? err.message : String(err));
        }
    }
}

function authorizationCodeFromBody(body: unknown): string | undefined {
    if (typeof body !== 'string' || !body) return undefined;
    try {
        return JSON.parse(body).data?.code;
    } catch {
        return undefined;
    }
}
