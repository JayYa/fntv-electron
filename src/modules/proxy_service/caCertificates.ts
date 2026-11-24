import * as tls from 'node:tls';

let cached: string[] | undefined;

export function trustedCaCertificates(): string[] {
    if (!cached) {
        cached = [...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])];
    }
    return cached;
}
