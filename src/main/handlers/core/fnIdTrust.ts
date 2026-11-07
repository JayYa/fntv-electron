import { isIP } from 'net';

/**
 * FN ID 登录窗口的页面信任判断。
 *
 * FN Connect 运行时才返回 NAS 地址（局域网 IP、公网 IP、DDNS 或中继），无法预先列白名单。
 * 所以把窗口离开 FN Connect 时到达的第一个地址确认为目标 origin，之后只有这个 origin
 * 才能拿到凭据。5ddd.com/{fnId} 路径下的页面视同 NAS 页面，见 fnConnect.ts。
 */
export interface FnIdTrust {
    fnConnectUrl: string;
    targetOrigin: string | null;
}

// check.fnos.net 是 FN Connect 给旧版 NAS 用的 HTTP 探测页，只在这里允许明文。
const FN_CONNECT_HOSTS: ReadonlyMap<string, readonly string[]> = new Map([
    ['5ddd.com', ['https:']],
    ['www.5ddd.com', ['https:']],
    ['check.fnos.net', ['http:', 'https:']],
]);

// FN Connect 页脚的外链，不是 NAS 地址。
const FN_CONNECT_EXTERNAL_LINK_HOSTS: ReadonlySet<string> = new Set([
    'fnnas.com',
    'www.fnnas.com',
    'beian.miit.gov.cn',
]);

const LOGIN_PATH = /^(\/v)?\/login\/?$/;

function parseWebUrl(url: string): URL | null {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        if (parsed.username || parsed.password) return null;
        return parsed;
    } catch {
        return null;
    }
}

function isFnConnectPage(url: URL): boolean {
    return FN_CONNECT_HOSTS.get(url.hostname)?.includes(url.protocol) ?? false;
}

function isDowngrade(from: URL, to: URL): boolean {
    return from.protocol === 'https:' && to.protocol === 'http:';
}

/** 返回 NAS 页面在 NAS 站点内的路径，不是 NAS 页面时返回 null。 */
function nasPagePath(url: URL, trust: FnIdTrust): string | null {
    if (url.origin === trust.targetOrigin) return url.pathname;

    const relay = new URL(trust.fnConnectUrl);
    if (url.origin !== relay.origin) return null;
    if (url.pathname === relay.pathname) return '/';
    return url.pathname.startsWith(`${relay.pathname}/`)
        ? url.pathname.slice(relay.pathname.length)
        : null;
}

/** 按 Cookie 规则判断 host 能否读到 domain 下的 Cookie。domain 不含端口，以点开头时包含子域。 */
function cookieDomainCovers(domain: string, host: string): boolean {
    const normalized = domain.toLowerCase();
    if (normalized.replace(/^[.]/, '') === host) return true;
    return normalized.startsWith('.') && !isIP(host) && host.endsWith(normalized);
}

// 只记路径和 hash 路由：查询串里可能有授权码和 state。FN Connect 的路径就是 FN ID，也不记。
export function describeFnIdPageForLog(pageUrl: string, fnId: string): string {
    try {
        const page = new URL(pageUrl);
        const pathname = page.pathname
            .split('/')
            .map(segment => (segment.toLowerCase() === fnId.toLowerCase() ? '(FN ID)' : segment))
            .join('/');
        return `${pathname}${page.hash.split('?')[0]}`;
    } catch {
        return '(无效地址)';
    }
}

export function createFnIdTrust(fnConnectUrl: string): FnIdTrust {
    return { fnConnectUrl, targetOrigin: null };
}

/** 能运行拦截脚本、填写访问码、向主进程发消息的页面。 */
export function isFnIdNasPage(pageUrl: string, trust: FnIdTrust): boolean {
    const page = parseWebUrl(pageUrl);
    return page !== null && nasPagePath(page, trust) !== null;
}

/** 能填写明文密码的页面。 */
export function isFnIdLoginPage(pageUrl: string, trust: FnIdTrust): boolean {
    const page = parseWebUrl(pageUrl);
    const path = page && nasPagePath(page, trust);
    return typeof path === 'string' && LOGIN_PATH.test(path);
}

/**
 * 登录窗口的分区里，确认目标前只认中继页的 Cookie，确认后只认目标 NAS 的 Cookie。
 * 中继页不看 Cookie 的路径：真实中继没有验证过，路径猜错会让中继登录失败。
 * 取到的 token 还要过 NAS 的用户信息接口，这里只排除其它站点的 Cookie。
 */
export function isFnIdTokenCookie(cookie: { domain?: string }, trust: FnIdTrust): boolean {
    const { domain } = cookie;
    if (!domain) return false;
    // 确认目标后中继的 Cookie 不再可用：它不是目标 NAS 的 token，放弃后还能走 OAuth。
    return cookieDomainCovers(domain, new URL(trust.targetOrigin ?? trust.fnConnectUrl).hostname);
}

/**
 * 判断主框架能否跳转到 url。返回跳转后的信任状态，null 表示拒绝。
 * 确认目标后只允许同主机跳转，端口可变，不能从 HTTPS 降到 HTTP，
 * 规则和访问码验证的重定向一致（ADR 0002）。
 */
export function resolveFnIdNavigation(url: string, trust: FnIdTrust): FnIdTrust | null {
    const target = parseWebUrl(url);
    if (!target) return null;
    if (isFnConnectPage(target)) return trust;
    if (FN_CONNECT_HOSTS.has(target.hostname)) return null;

    if (trust.targetOrigin === null) {
        if (FN_CONNECT_EXTERNAL_LINK_HOSTS.has(target.hostname)) return null;
        return { ...trust, targetOrigin: target.origin };
    }

    const confirmed = new URL(trust.targetOrigin);
    if (target.hostname !== confirmed.hostname || isDowngrade(confirmed, target)) return null;
    return { ...trust, targetOrigin: target.origin };
}

/**
 * FN Connect 的地址选择页用 target="_blank" 打开 NAS，这种情况改在当前窗口继续。
 * 其它弹窗一律拒绝。返回值含义同 resolveFnIdNavigation。
 */
export function resolveFnIdWindowOpen(
    url: string,
    openerUrl: string,
    trust: FnIdTrust,
): FnIdTrust | null {
    const opener = parseWebUrl(openerUrl);
    if (!opener || !isFnConnectPage(opener) || trust.targetOrigin !== null) return null;
    return resolveFnIdNavigation(url, trust);
}

/**
 * NAS 在 sys/config 里报告的 OAuth 地址可以和当前页面不同主机。
 * 调用方要先确认消息来自 NAS 页面。返回 null 时应继续使用当前页面的 origin。
 */
export function resolveFnIdOauthTrust(oauthUrl: string, trust: FnIdTrust): FnIdTrust | null {
    const target = parseWebUrl(oauthUrl);
    if (!target || FN_CONNECT_HOSTS.has(target.hostname)) return null;
    if (isDowngrade(new URL(trust.targetOrigin ?? trust.fnConnectUrl), target)) return null;
    return { ...trust, targetOrigin: target.origin };
}
