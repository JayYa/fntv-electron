const accessGrants = new Map<string, string>();

function normalizeOrigin(value: string): string | null {
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        return url.origin;
    } catch {
        return null;
    }
}

export function setAccessGrant(origin: string, cookie: string): void {
    const normalizedOrigin = normalizeOrigin(origin);
    if (!normalizedOrigin) throw new Error('无效的访问码会话地址');

    if (cookie) {
        accessGrants.set(normalizedOrigin, cookie);
    } else {
        accessGrants.delete(normalizedOrigin);
    }
}

export function clearAccessGrants(): void {
    accessGrants.clear();
}

export function getAccessCookieHeader(origin: string): string {
    const normalizedOrigin = normalizeOrigin(origin);
    return normalizedOrigin ? accessGrants.get(normalizedOrigin) || '' : '';
}
