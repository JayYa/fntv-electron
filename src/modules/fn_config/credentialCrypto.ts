import * as crypto from 'crypto';
import { safeStorage } from 'electron';
import { platformBehavior } from '../../public/platform';

const ENCRYPTION_KEY = 'U2XDcFsV6rdTE9wB5ZHvy6BW9hBTKJ1H'; // 32 chars for aes-256
const IV = Buffer.alloc(16, 0); // Initialization vector
const SAFE_STORAGE_PREFIX = 'safe-storage:v1:';

/** 凭据在没有 safeStorage 前缀时的旧格式：明文，或旧版本用固定密钥加密的密码。 */
export type LegacyFormat = 'plaintext' | 'legacyPassword';

/**
 * 内存里的一个凭据。plain 是明文，stored 是可以原样写回的磁盘值；没有 stored 时写入前要加密
 * （新值、旧格式、safeStorage 要求重新加密）。sealed 是没解开的磁盘值，原样写回，读出来是空值。
 */
export type Credential = { plain: string; stored?: string } | { sealed: string };

export const NO_CREDENTIAL: Credential = { plain: '' };

export function plaintextOf(credential: Credential): string {
    return 'plain' in credential ? credential.plain : '';
}

/** 不解密，原样带着磁盘值。 */
export function sealedCredential(stored: string): Credential {
    return stored ? { sealed: stored } : NO_CREDENTIAL;
}

// 仅用于读取旧版本固定密钥加密的密码。
function decryptLegacyPassword(encrypted: string): string {
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), IV);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

/** 解开一个磁盘值；解不开时得到 sealed。 */
export async function openCredential(stored: string, legacy: LegacyFormat): Promise<Credential> {
    if (!stored) return NO_CREDENTIAL;
    if (!stored.startsWith(SAFE_STORAGE_PREFIX)) {
        if (legacy === 'plaintext') return { plain: stored };
        try {
            return { plain: decryptLegacyPassword(stored) };
        } catch {
            return { sealed: stored };
        }
    }
    try {
        const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(
            Buffer.from(stored.slice(SAFE_STORAGE_PREFIX.length), 'base64'),
        );
        return shouldReEncrypt ? { plain: result } : { plain: result, stored };
    } catch {
        return { sealed: stored };
    }
}

export function needsEncryption(credential: Credential): credential is { plain: string } {
    return 'plain' in credential && credential.plain !== '' && credential.stored === undefined;
}

async function isEncryptionAvailable(): Promise<boolean> {
    try {
        return await safeStorage.isAsyncEncryptionAvailable();
    } catch {
        return false;
    }
}

/**
 * 加密这些明文，返回明文到磁盘值。没有要加密的明文时不检查存储；
 * 存储不可用或只有 basic_text 时抛错，一个都不加密。
 */
export async function encryptAll(plaintexts: Iterable<string>): Promise<Map<string, string>> {
    const unique = new Set(plaintexts);
    const encrypted = new Map<string, string>();
    if (unique.size === 0) return encrypted;
    if (!await isEncryptionAvailable()) {
        throw new Error('操作系统安全存储不可用，无法保存登录凭据');
    }
    if (platformBehavior().rejectsBasicTextStorage && safeStorage.getSelectedStorageBackend() === 'basic_text') {
        throw new Error('Linux 系统未提供可用的密钥环，拒绝以明文方式保存登录凭据');
    }
    for (const value of unique) {
        encrypted.set(value, SAFE_STORAGE_PREFIX + (await safeStorage.encryptStringAsync(value)).toString('base64'));
    }
    return encrypted;
}

/** 写回磁盘的值。要加密的明文必须已在 encrypted 里。 */
export function storedValueOf(credential: Credential, encrypted: Map<string, string>): string {
    if ('sealed' in credential) return credential.sealed;
    if (credential.stored !== undefined) return credential.stored;
    if (!credential.plain) return '';
    const value = encrypted.get(credential.plain);
    if (value === undefined) throw new Error('凭据没有预先加密');
    return value;
}
