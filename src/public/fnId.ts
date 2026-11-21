export function isFnId(domain: string): boolean {
    if (!domain) return false;
    return /^[A-Za-z0-9_-]{6,30}$/.test(domain.trim());
}
