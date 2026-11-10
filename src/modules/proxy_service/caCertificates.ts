// 校验证书用的 CA：Node 自带的加上操作系统证书库（U-17）。Go 版用系统证书库，
// 装在系统里的私有 CA 签发的 NAS 证书在 Go 版能过，这里也要能过。
import * as tls from 'node:tls';

let cached: string[] | undefined;

export function trustedCaCertificates(): string[] {
    if (!cached) {
        cached = [...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])];
    }
    return cached;
}
