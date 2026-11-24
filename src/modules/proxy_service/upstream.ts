import * as http from 'node:http';
import * as https from 'node:https';
import type { ForwardTarget } from './forward';

export function openUpstream(
    target: ForwardTarget,
    headers: Record<string, string>,
    method: string,
    signal: AbortSignal,
): http.ClientRequest {
    const url = new URL(target.url);
    const isHttps = url.protocol === 'https:';
    const options: https.RequestOptions = {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        agent: false,
        signal,
    };
    if (isHttps) {
        options.rejectUnauthorized = !target.skipVerify;
        options.ca = target.ca;
    }
    return (isHttps ? https : http).request(options);
}
