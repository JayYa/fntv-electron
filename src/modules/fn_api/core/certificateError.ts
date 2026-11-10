// 按错误码判断是不是证书校验失败。证书信任的读取和弹窗依赖 Electron，留在 cert_trust。
const CERTIFICATE_ERROR_CODES = new Set([
    'UNABLE_TO_GET_ISSUER_CERT',       // 无法获得颁发者证书。
    'UNABLE_TO_GET_CRL',               // 无法获得证书 CRL。
    'UNABLE_TO_DECRYPT_CERT_SIGNATURE',// 无法解密证书的签名。
    'UNABLE_TO_DECRYPT_CRL_SIGNATURE', // 无法解密 CRL 的签名。
    'UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY', // 无法解码发行者公钥。
    'CERT_SIGNATURE_FAILURE',          // 证书签名失败。
    'CRL_SIGNATURE_FAILURE',           // CRL 签名失败。
    'CERT_NOT_YET_VALID',              // 证书尚未生效。
    'CERT_HAS_EXPIRED',                // 证书已过期。
    'CRL_NOT_YET_VALID',               // CRL 尚未生效。
    'CRL_HAS_EXPIRED',                 // CRL 已过期。
    'ERROR_IN_CERT_NOT_BEFORE_FIELD',  // 证书的 notBefore 字段中的格式错误。
    'ERROR_IN_CERT_NOT_AFTER_FIELD',   // 证书的 notAfter 字段中的格式错误。
    'ERROR_IN_CRL_LAST_UPDATE_FIELD',  // CRL 的 lastUpdate 字段中的格式错误。
    'ERROR_IN_CRL_NEXT_UPDATE_FIELD',  // CRL 的 nextUpdate 字段中的格式错误。
    'OUT_OF_MEM',                      // 内存不足。
    'DEPTH_ZERO_SELF_SIGNED_CERT',     // 自签名证书。
    'SELF_SIGNED_CERT_IN_CHAIN',       // 证书链中的自签名证书。
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', // 无法获得本地颁发者证书。
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE', // 无法验证第一个证书。
    'CERT_CHAIN_TOO_LONG',             // 证书链太长。
    'CERT_REVOKED',                    // 证书已撤销。
    'INVALID_CA',                      // 无效的 CA 证书。
    'PATH_LENGTH_EXCEEDED',            // 超出路径长度限制。
    'INVALID_PURPOSE',                 // 不支持的证书用途。
    'CERT_UNTRUSTED',                  // 证书不受信任。
    'CERT_REJECTED',                   // 证书被拒绝。
    'HOSTNAME_MISMATCH',               // 主机名不匹配。
    'ERR_TLS_CERT_ALTNAME_INVALID',    // 主机名/证书名称不匹配
]);

export function isCertificateError(error: any): boolean {
    return error && CERTIFICATE_ERROR_CODES.has(error.code);
}
