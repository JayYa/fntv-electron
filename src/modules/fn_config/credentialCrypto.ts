import * as crypto from 'crypto';
import { safeStorage } from 'electron';
import { platformBehavior } from '../../public/platform';

const ENCRYPTION_KEY = 'U2XDcFsV6rdTE9wB5ZHvy6BW9hBTKJ1H'; // 32 chars for aes-256
const IV = Buffer.alloc(16, 0); // Initialization vector
const SAFE_STORAGE_PREFIX = 'safe-storage:v1:';

/** 磁盘上的一个非空凭据值。isLegacyPassword 表示旧格式时是固定密钥加密的密码，否则旧格式是明文。 */
export interface CredentialField {
    value: string;
    isLegacyPassword: boolean;
}

/**
 * 一次凭据操作预先算好的加解密结果。safeStorage 只有异步接口，所以先把磁盘上的密文全部解开、
 * 要写入时再把所有明文加密，之后的读改写同步完成：中途不让出事件循环，别的写入插不进来。
 */
export interface PreparedCredentials {
    /** 磁盘上的值（带前缀）到解密结果；解不开的存错误。 */
    decrypted: Map<string, { value: string; reEncrypt: boolean } | Error>;
    /** 明文到要写入磁盘的值（带前缀）。只在准备写入时填。 */
    encrypted: Map<string, string>;
    /** isAsyncEncryptionAvailable 的结果；没有要加密的明文时不检查，为 false。 */
    encryptionAvailable: boolean;
    /** 不能加密的原因，写入凭据时抛出。 */
    encryptionError?: Error;
}

// 仅用于读取旧版本固定密钥加密的密码。
function decryptLegacyPassword(encrypted: string): string {
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), IV);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

async function isEncryptionAvailable(): Promise<boolean> {
    try {
        return await safeStorage.isAsyncEncryptionAvailable();
    } catch {
        return false;
    }
}

// 写入时每个非空凭据都重新加密，和同步接口时一样：存储不可用或只有 basic_text 时一律拒绝。
async function encryptAll(prepared: PreparedCredentials, plaintexts: Set<string>): Promise<void> {
    if (plaintexts.size === 0) return;
    prepared.encryptionAvailable = await isEncryptionAvailable();
    if (!prepared.encryptionAvailable) {
        prepared.encryptionError = new Error('操作系统安全存储不可用，无法保存登录凭据');
    } else if (platformBehavior().rejectsBasicTextStorage && safeStorage.getSelectedStorageBackend() === 'basic_text') {
        prepared.encryptionError = new Error('Linux 系统未提供可用的密钥环，拒绝以明文方式保存登录凭据');
    }
    if (prepared.encryptionError) return;
    for (const value of plaintexts) {
        prepared.encrypted.set(value, SAFE_STORAGE_PREFIX + (await safeStorage.encryptStringAsync(value)).toString('base64'));
    }
}

/**
 * 解开 fields 里的密文。forWrite 不为 undefined 时准备写入：磁盘上的凭据（含旧格式）
 * 和 forWrite 里的新凭据全部加密。
 */
export async function prepareCredentials(fields: CredentialField[], forWrite?: (string | undefined)[]): Promise<PreparedCredentials> {
    const prepared: PreparedCredentials = { decrypted: new Map(), encrypted: new Map(), encryptionAvailable: false };
    const plaintexts = new Set((forWrite ?? []).filter((value): value is string => Boolean(value)));
    for (const { value, isLegacyPassword } of fields) {
        if (!value.startsWith(SAFE_STORAGE_PREFIX)) {
            try {
                plaintexts.add(isLegacyPassword ? decryptLegacyPassword(value) : value);
            } catch {
                // 解不开的旧格式密码由读取流程按解密失败处理。
            }
            continue;
        }
        if (prepared.decrypted.has(value)) continue;
        try {
            const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(
                Buffer.from(value.slice(SAFE_STORAGE_PREFIX.length), 'base64'),
            );
            prepared.decrypted.set(value, { value: result, reEncrypt: shouldReEncrypt });
            plaintexts.add(result);
        } catch (error) {
            prepared.decrypted.set(value, error instanceof Error ? error : new Error('凭据解密失败'));
        }
    }
    if (forWrite !== undefined) await encryptAll(prepared, plaintexts);
    return prepared;
}

export function encryptCredential(value: string, prepared: PreparedCredentials): string {
    if (!value) return '';
    const stored = prepared.encrypted.get(value);
    if (stored !== undefined) return stored;
    throw prepared.encryptionError ?? new Error('凭据没有预先加密');
}

// rewrite 为 true 表示磁盘上的值要重写：旧格式，或者 safeStorage 要求重新加密。
export function decryptCredential(value: string, isLegacyPassword: boolean, prepared: PreparedCredentials): { value: string; rewrite: boolean } {
    if (!value) return { value: '', rewrite: false };
    if (value.startsWith(SAFE_STORAGE_PREFIX)) {
        const result = prepared.decrypted.get(value);
        if (result === undefined) throw new Error('凭据没有预先解密');
        if (result instanceof Error) throw result;
        return { value: result.value, rewrite: result.reEncrypt };
    }
    return {
        value: isLegacyPassword ? decryptLegacyPassword(value) : value,
        rewrite: true,
    };
}
