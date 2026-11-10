// 直链媒体：飞牛影视服务给出了可直接访问地址的播放源。判定规则与 Go 版一致。
import type { StreamResponse } from '../fn_api/core/types';
import type { ForwardTarget } from './forward';

export interface DirectLink {
    url: string;
    // 流信息里的 Cookie 用 "; " 连接，不去重、不加 mode=relay；没有时为空串。
    cookie: string;
    // 流信息里第一个 trim 后非空的 UA，没有时为空串。
    userAgent: string;
    // 飞牛影视服务的云盘类型：CLOUD_TYPE_115、CLOUD_TYPE_QUARK 特殊处理，其余网盘透明转发。
    cloudType: number;
}

// cloud_storage_info 非空且有直链时才算直链媒体，否则按 NAS 本地播放源处理。
// 直链固定取第一个，不随 sourceIndex 或清晰度变化。
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

// 直链直连的取流目标：不带 NAS 的 Authorization 和访问授权 Cookie，强制校验证书，不管会话的 skipVerify。
export function cloudDirectTarget(link: DirectLink, ca: string[]): ForwardTarget {
    const headers: Record<string, string> = {};
    if (link.cookie) headers.cookie = link.cookie;
    // 流信息给了 UA 时所有直连网盘都用它，覆盖 MPV 的 UA（U-09，与 Go 版一致）。
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

// WebDAV 这类直链把账号写在 URL 里：改成 Basic 认证，从 URL 里去掉账号。
// MPV 的 Authorization 不转发（U-05），所以有账号时总是补上。解析不了的 URL 原样返回，由转发报错。
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
