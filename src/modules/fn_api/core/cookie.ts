// 访问授权 Cookie 和其它 Cookie 拼成一个请求头。主进程和 Proxy 共用这一个实现。

function cookieParts(values: Array<string | undefined>): string[] {
    const result: string[] = [];
    const names = new Set<string>();

    for (const value of values) {
        for (const rawPart of (value || '').split(';')) {
            const part = rawPart.trim();
            const separator = part.indexOf('=');
            if (separator <= 0) continue;

            const name = part.slice(0, separator).trim();
            const normalizedName = name.toLowerCase();
            if (!name || normalizedName === 'mode' || names.has(normalizedName)) continue;
            names.add(normalizedName);
            result.push(`${name}=${part.slice(separator + 1).trim()}`);
        }
    }

    result.push('mode=relay');
    return result;
}

export function composeCookieHeader(...values: Array<string | undefined>): string {
    return cookieParts(values).join('; ');
}
