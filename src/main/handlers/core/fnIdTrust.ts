import { isIP } from 'net';

export interface FnIdTrust {
    fnConnectUrl: string;
    targetOrigin: string | null;
}

const FN_CONNECT_HOSTS: ReadonlySet<string> = new Set(['5ddd.com', 'www.5ddd.com', 'check.fnos.net']);

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
    return url.protocol === 'https:' && FN_CONNECT_HOSTS.has(url.hostname);
}

function isDowngrade(from: URL, to: URL): boolean {
    return from.protocol === 'https:' && to.protocol === 'http:';
}

function nasPagePath(url: URL, trust: FnIdTrust): string | null {
    if (url.origin === trust.targetOrigin) return url.pathname;

    const relay = new URL(trust.fnConnectUrl);
    if (url.origin !== relay.origin) return null;
    if (url.pathname === relay.pathname) return '/';
    return url.pathname.startsWith(`${relay.pathname}/`)
        ? url.pathname.slice(relay.pathname.length)
        : null;
}

function cookieDomainCovers(domain: string, host: string): boolean {
    const normalized = domain.toLowerCase();
    if (normalized.replace(/^[.]/, '') === host) return true;
    return normalized.startsWith('.') && !isIP(host) && host.endsWith(normalized);
}

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

export function isFnIdNasPage(pageUrl: string, trust: FnIdTrust): boolean {
    const page = parseWebUrl(pageUrl);
    return page !== null && nasPagePath(page, trust) !== null;
}

export function isFnIdLoginPage(pageUrl: string, trust: FnIdTrust): boolean {
    const page = parseWebUrl(pageUrl);
    const path = page && nasPagePath(page, trust);
    return typeof path === 'string' && LOGIN_PATH.test(path);
}

export function isFnIdTokenCookie(cookie: { domain?: string }, trust: FnIdTrust): boolean {
    const { domain } = cookie;
    if (!domain) return false;
    return cookieDomainCovers(domain, new URL(trust.targetOrigin ?? trust.fnConnectUrl).hostname);
}

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

export function resolveFnIdWindowOpen(
    url: string,
    openerUrl: string,
    trust: FnIdTrust,
): FnIdTrust | null {
    const opener = parseWebUrl(openerUrl);
    if (!opener || !isFnConnectPage(opener) || trust.targetOrigin !== null) return null;
    return resolveFnIdNavigation(url, trust);
}

export function resolveFnIdOauthTrust(oauthUrl: string, trust: FnIdTrust): FnIdTrust | null {
    const target = parseWebUrl(oauthUrl);
    if (!target || FN_CONNECT_HOSTS.has(target.hostname)) return null;
    if (isDowngrade(new URL(trust.targetOrigin ?? trust.fnConnectUrl), target)) return null;
    return { ...trust, targetOrigin: target.origin };
}
