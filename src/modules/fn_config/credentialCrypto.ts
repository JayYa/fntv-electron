import * as crypto from 'crypto';
import { safeStorage } from 'electron';
import { platformBehavior } from '../../public/platform';

const ENCRYPTION_KEY = 'U2XDcFsV6rdTE9wB5ZHvy6BW9hBTKJ1H';
const IV = Buffer.alloc(16, 0);
const SAFE_STORAGE_PREFIX = 'safe-storage:v1:';

export type LegacyFormat = 'plaintext' | 'legacyPassword';

export type Credential = { plain: string; stored?: string } | { sealed: string };

export const NO_CREDENTIAL: Credential = { plain: '' };

export function plaintextOf(credential: Credential): string {
    return 'plain' in credential ? credential.plain : '';
}

export function sealedCredential(stored: string): Credential {
    return stored ? { sealed: stored } : NO_CREDENTIAL;
}

function decryptLegacyPassword(encrypted: string): string {
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), IV);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

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

export function storedValueOf(credential: Credential, encrypted: Map<string, string>): string {
    if ('sealed' in credential) return credential.sealed;
    if (credential.stored !== undefined) return credential.stored;
    if (!credential.plain) return '';
    const value = encrypted.get(credential.plain);
    if (value === undefined) throw new Error('凭据没有预先加密');
    return value;
}
