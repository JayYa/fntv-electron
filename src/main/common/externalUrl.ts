export function resolveAllowedExternalUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null;

    try {
        const target = new URL(value);
        if (target.protocol !== 'https:' || target.hostname !== 'github.com') return null;
        if (target.username || target.password || target.port) return null;
        return target.toString();
    } catch {
        return null;
    }
}
