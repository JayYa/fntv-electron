/**
 * 判断渲染进程请求打开的外链是否放行，放行时返回规范化后的地址，否则返回 null。
 * 只放行 https://github.com。
 */
export function resolveAllowedExternalUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null;

    try {
        const target = new URL(value);
        if (target.protocol !== 'https:' || target.hostname !== 'github.com') return null;
        return target.toString();
    } catch {
        return null;
    }
}
