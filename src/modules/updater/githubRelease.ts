import axios from 'axios';
import { currentArch, currentPlatform, installerAssetName } from '../../public/platform';

export interface GitHubRepository {
    owner: string;
    repo: string;
}

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
        return Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000) : new Date(now + 60 * 60 * 1000);
    }
    return null;
}

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

export function isRetryable(error: any): boolean {
    const status = error?.response?.status;
    return status === undefined || status >= 500;
}

export function releasePageUrl({ owner, repo }: GitHubRepository): string {
    return `https://github.com/${owner}/${repo}/releases/latest`;
}

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

export function expectedAssetName(version: string, platform: NodeJS.Platform = currentPlatform(), arch: string = currentArch()): string | null {
    return installerAssetName(platform, arch, version);
}

export function assetDownloadUrl({ owner, repo }: GitHubRepository, tagName: string, assetName: string): string {
    return `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(tagName)}/${assetName}`;
}

export function formatClock(date: Date): string {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
