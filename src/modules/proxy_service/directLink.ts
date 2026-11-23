import type { StreamResponse } from '../fn_api/core/types';
import type { ForwardTarget } from './forward';

export interface DirectLink {
    url: string;
    cookie: string;
    userAgent: string;
    cloudType: number;
}

export function directLinkOf(stream: StreamResponse): DirectLink | undefined {
    const qualities = stream.direct_link_qualities ?? [];
    if (!stream.cloud_storage_info || qualities.length === 0) return undefined;
    return {
        url: qualities[0].url,
        cookie: (stream.header?.Cookie ?? []).join('; '),
        userAgent: (stream.header?.['User-Agent'] ?? []).map((ua) => ua.trim()).find(Boolean) ?? '',
        cloudType: stream.cloud_storage_info.cloud_storage_type,
    };
}

export function cloudDirectTarget(link: DirectLink, ca: string[]): ForwardTarget {
    const headers: Record<string, string> = {};
    if (link.cookie) headers.cookie = link.cookie;
    if (link.userAgent) headers['user-agent'] = link.userAgent;
    return { url: withBasicAuth(link.url, headers), headers, skipVerify: false, ca };
}

function decodeUserinfo(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function withBasicAuth(rawUrl: string, headers: Record<string, string>): string {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return rawUrl;
    }
    if (!url.username) return rawUrl;
    const credentials = `${decodeUserinfo(url.username)}:${decodeUserinfo(url.password)}`;
    headers.authorization = `Basic ${Buffer.from(credentials, 'utf8').toString('base64')}`;
    url.username = '';
    url.password = '';
    return url.href;
}
