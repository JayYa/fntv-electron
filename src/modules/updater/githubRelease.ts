import axios from 'axios';

// GitHub 访问细节：限流判断、Release 页面回退、安装包命名

export interface GitHubRepository {
    owner: string;
    repo: string;
}

/**
 * 未认证的 GitHub API 每个出口 IP 每小时 60 次，NAT、代理和 VPN 后面的请求共用额度。
 * 返回额度恢复的时间；不是限流时返回 null。
 * 注意：未认证时带 If-None-Match 得到 304 也会扣额度（2026-11-07 实测），所以这里不做条件请求。
 */
export function rateLimitResetAt(error: any, now: number = Date.now()): Date | null {
    const response = error?.response;
    if (!response || (response.status !== 403 && response.status !== 429)) {
        return null;
    }
    const headers = response.headers || {};
    const retryAfter = Number(headers['retry-after']);
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
        return new Date(now + retryAfter * 1000);
    }
    const reset = Number(headers['x-ratelimit-reset']);
    const message = String(response.data?.message || '');
    if (headers['x-ratelimit-remaining'] === '0' || /rate limit/i.test(message) || response.status === 429) {
        // 拿不到恢复时间时按一小时窗口估算
        return Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000) : new Date(now + 60 * 60 * 1000);
    }
    return null;
}

/**
 * 记录 GitHub 错误的诊断信息：状态码、剩余额度、恢复时间和错误正文
 */
export function describeGitHubError(error: any): string {
    const response = error?.response;
    if (!response) {
        return `${error?.code || 'NETWORK'} ${error?.message || ''}`.trim();
    }
    const headers = response.headers || {};
    const message = typeof response.data === 'object' ? response.data?.message : '';
    return [
        `HTTP ${response.status}`,
        `x-ratelimit-remaining=${headers['x-ratelimit-remaining'] ?? '-'}`,
        `x-ratelimit-reset=${headers['x-ratelimit-reset'] ?? '-'}`,
        `retry-after=${headers['retry-after'] ?? '-'}`,
        `message=${message || '-'}`,
    ].join(' ');
}

/**
 * 网络错误、超时和 5xx 值得重试；4xx 在几秒内不会变，重试只会多耗额度
 */
export function isRetryable(error: any): boolean {
    const status = error?.response?.status;
    return status === undefined || status >= 500;
}

export function releasePageUrl({ owner, repo }: GitHubRepository): string {
    return `https://github.com/${owner}/${repo}/releases/latest`;
}

/**
 * 请求 github.com 的 releases/latest 页面，不跟随重定向，从 Location 取 tag。
 * 这个页面不走 API 限流。
 */
export async function fetchLatestTagFromReleasePage(repository: GitHubRepository, userAgent: string): Promise<string> {
    const response = await axios.get(releasePageUrl(repository), {
        timeout: 10000,
        maxRedirects: 0,
        validateStatus: (status: number) => status >= 300 && status < 400,
        headers: { 'User-Agent': userAgent },
    });
    const location = String(response.headers?.location || '');
    const match = location.match(/\/releases\/tag\/([^/?#]+)/);
    if (!match) {
        throw new Error(`Release 页面没有指向具体版本: ${location || '无 Location'}`);
    }
    return decodeURIComponent(match[1]);
}

/**
 * 按 package.json 的 artifactName（FNMedia_${version}_${os}_${arch}.${ext}）拼出当前平台的安装包名。
 * 以 v2.7.0 的真实资产核对过：Linux x64 是 x86_64。
 */
export function expectedAssetName(version: string, platform: string = process.platform, arch: string = process.arch): string | null {
    if (platform === 'win32' && arch === 'x64') return `FNMedia_${version}_win_x64.exe`;
    if (platform === 'darwin' && (arch === 'x64' || arch === 'arm64')) return `FNMedia_${version}_mac_${arch}.dmg`;
    if (platform === 'linux' && arch === 'x64') return `FNMedia_${version}_linux_x86_64.AppImage`;
    if (platform === 'linux' && arch === 'arm64') return `FNMedia_${version}_linux_arm64.AppImage`;
    return null;
}

export function assetDownloadUrl({ owner, repo }: GitHubRepository, tagName: string, assetName: string): string {
    return `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(tagName)}/${assetName}`;
}

/**
 * 本地时间 HH:mm
 */
export function formatClock(date: Date): string {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
