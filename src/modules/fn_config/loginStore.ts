import { type StoredConfig, type StoredHistoryItem, readConfigFile, usableHistory, warnOnce, writeConfigFile } from './configFile';
import {
    type Credential,
    type LegacyFormat,
    NO_CREDENTIAL,
    encryptAll,
    needsEncryption,
    openCredential,
    plaintextOf,
    sealedCredential,
    storedValueOf,
} from './credentialCrypto';

// 登录存储：当前登录和登录历史在 config.json 里的加密保存。设置项在同一个文件里，归 settings.ts。

const HISTORY_LIMIT = 5;

// 凭据字段只在这里登记，读、解密和加密写回都按这两张表走。值是没有 safeStorage 前缀时的旧格式。
const LOGIN_CREDENTIALS = { token: 'plaintext', accessCode: 'plaintext' } as const satisfies Record<string, LegacyFormat>;
const HISTORY_CREDENTIALS = { password: 'legacyPassword', accessCode: 'plaintext' } as const satisfies Record<string, LegacyFormat>;

type Credentials<Table> = { -readonly [Field in keyof Table]: Credential };

interface HistoryEntry {
    /** 磁盘上的这一条，凭据以外的字段原样写回。 */
    item: StoredHistoryItem;
    credentials: Credentials<typeof HISTORY_CREDENTIALS>;
}

interface LoginState {
    found: boolean;
    account?: unknown;
    domain?: unknown;
    useHttps?: unknown;
    credentials: Credentials<typeof LOGIN_CREDENTIALS>;
    history?: HistoryEntry[];
}

/** 读取当前登录的结果。token 为空表示已退出登录或凭据解不开。 */
export interface SavedLogin {
    domain: string;
    account: string;
    token: string;
    accessCode: string;
    useHttps: boolean;
}

export interface LoginToSave {
    domain: string;
    account: string;
    token: string;
    accessCode: string;
    useHttps: boolean;
}

export interface HistoryKey {
    domain: string;
    account: string;
}

export interface NewHistoryEntry extends HistoryKey {
    password: string;
    accessCode?: string;
    useHttps?: boolean;
}

/** 登录历史列表的一条，不含凭据。 */
export interface HistoryListing extends HistoryKey {
    useHttps: boolean;
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

async function readCredentials<Table extends Record<string, LegacyFormat>>(
    table: Table,
    source: Record<string, unknown>,
    label: string,
    decrypt: boolean,
): Promise<Credentials<Table>> {
    const credentials = {} as Credentials<Table>;
    for (const field of Object.keys(table) as (keyof Table & string)[]) {
        const stored = asString(source[field]);
        if (!decrypt) {
            credentials[field] = sealedCredential(stored);
            continue;
        }
        const credential = await openCredential(stored, table[field]);
        // 只记字段名：错误可能带密文。
        if ('sealed' in credential) warnOnce(`凭据解密失败，按未登录处理: ${label}${field}`);
        credentials[field] = credential;
    }
    return credentials;
}

// 原来没有这个字段、现在也是空值时不加字段。
function writeCredentials(target: Record<string, unknown>, credentials: Record<string, Credential>, encrypted: Map<string, string>): void {
    for (const [field, credential] of Object.entries(credentials)) {
        const value = storedValueOf(credential, encrypted);
        if (value !== '' || field in target) target[field] = value;
    }
}

// decrypt 为 false 时凭据保持磁盘值，用于只删条目、不碰明文的操作。
async function load(decrypt: boolean): Promise<LoginState> {
    const stored = readConfigFile();
    const source: StoredConfig = stored ?? {};
    const history = usableHistory(source);
    return {
        found: stored !== null,
        account: source.account,
        domain: source.domain,
        useHttps: source.useHttps,
        credentials: await readCredentials(LOGIN_CREDENTIALS, source, '', decrypt),
        history: history && await Promise.all(history.map(async (item, index) => ({
            item,
            credentials: await readCredentials(HISTORY_CREDENTIALS, item, `history[${index}].`, decrypt),
        }))),
    };
}

function allCredentials(state: LoginState): Credential[] {
    return [
        ...Object.values(state.credentials),
        ...(state.history ?? []).flatMap(entry => Object.values(entry.credentials)),
    ];
}

/**
 * 写回登录存储：先加密所有新明文，加密完成后才重新读文件取设置项，所以期间同步写入的设置项不会丢。
 * 加密失败时不写。
 */
async function commit(state: LoginState): Promise<void> {
    const encrypted = await encryptAll(allCredentials(state).filter(needsEncryption).map(credential => credential.plain));
    const stored: StoredConfig = {
        ...readConfigFile(),
        account: state.account,
        domain: state.domain,
        useHttps: state.useHttps,
    };
    writeCredentials(stored, state.credentials, encrypted);
    stored.history = state.history?.map(({ item, credentials }) => {
        const written: Record<string, unknown> = { ...item };
        writeCredentials(written, credentials, encrypted);
        return written;
    });
    writeConfigFile(stored);
}

// 登录存储的操作按调用顺序逐个执行：上一个的加解密和写入完成之前，下一个不读磁盘。
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
}

/** 凭据的唯一写路径。change 同步修改读出的状态，返回 false 时不写。 */
function transaction(decrypt: boolean, change: (state: LoginState) => boolean | void): Promise<boolean> {
    return serialize(async () => {
        const state = await load(decrypt);
        if (change(state) === false) return false;
        await commit(state);
        return true;
    });
}

/**
 * 读取当前登录，必要时把旧格式凭据迁移到安全存储；文件不存在或损坏时返回 null。
 * 访问码解不开时过不了网关，token 单独可用也不算已登录，所以 token 读出来为空。
 */
export function readCurrentLogin(): Promise<SavedLogin | null> {
    return serialize(async () => {
        const state = await load(true);
        if (!state.found) return null;
        if (allCredentials(state).some(needsEncryption)) {
            try {
                await commit(state);
            } catch {
                // 迁移失败不影响本次读取，旧值留在磁盘上，下次读取时重试。
                warnOnce('迁移旧版凭据失败，暂时保留原值');
            }
        }
        const { token, accessCode } = state.credentials;
        return {
            domain: asString(state.domain),
            account: asString(state.account),
            token: 'sealed' in accessCode ? '' : plaintextOf(token),
            accessCode: plaintextOf(accessCode),
            useHttps: state.useHttps === true,
        };
    });
}

// 从最旧的开始淘汰，解不开的留到最后：密钥恢复后它们还能用。下标 0 是刚加的，不淘汰。
function findEvictionIndex(history: HistoryEntry[]): number {
    for (let index = history.length - 1; index > 0; index--) {
        if (!Object.values(history[index].credentials).some(credential => 'sealed' in credential)) return index;
    }
    return history.length - 1;
}

function addToHistory(state: LoginState, { domain, account, password, accessCode, useHttps }: NewHistoryEntry): void {
    const history = (state.history ?? []).filter(entry => !(entry.item.domain === domain && entry.item.account === account));
    history.unshift({
        item: { domain, account, password: '', accessCode: '', useHttps: useHttps || false },
        credentials: { password: { plain: password }, accessCode: { plain: accessCode || '' } },
    });
    while (history.length > HISTORY_LIMIT) {
        history.splice(findEvictionIndex(history), 1);
    }
    state.history = history;
}

/**
 * 保存当前登录；给了 history 就在同一次写入里加进登录历史（去重、最多 5 条），两者要么都写上，要么都没写。
 * 新凭据总是重新加密：安全存储不可用时抛错，文件不变。解不开的旧凭据被这次的值替换。
 */
export function saveCurrentLogin(login: LoginToSave, history?: NewHistoryEntry): Promise<void> {
    return transaction(true, (state) => {
        state.account = login.account;
        state.domain = login.domain;
        state.useHttps = login.useHttps;
        state.credentials = { token: { plain: login.token }, accessCode: { plain: login.accessCode } };
        if (history) addToHistory(state, history);
    }).then(() => undefined);
}

/**
 * 退出登录：清空 token，保留账号、地址、访问码和 HTTPS 设置。解不开的 token 原样留着，
 * 密钥恢复后由用户重新登录替换。没有可清的内容时不写文件，返回 false。
 */
export function clearToken(): Promise<boolean> {
    return transaction(true, (state) => {
        const { token, accessCode } = state.credentials;
        const visibleToken = 'sealed' in accessCode ? '' : plaintextOf(token);
        if (!state.found || !(visibleToken || state.domain)) return false;
        state.account = asString(state.account);
        state.domain = asString(state.domain);
        state.useHttps = state.useHttps === true;
        if ('plain' in token) state.credentials.token = NO_CREDENTIAL;
        return true;
    });
}

/** 登录历史列表，不解密、不含凭据。读盘失败时抛出。 */
export function listHistory(): HistoryListing[] {
    const stored = readConfigFile();
    return (stored ? usableHistory(stored) ?? [] : []).map(item => ({
        domain: item.domain,
        account: item.account,
        useHttps: item.useHttps === true,
    }));
}

/** 一条登录历史的凭据。找不到或解不开时读出来是空值，由用户手动输入。 */
export function historyCredentials({ domain, account }: HistoryKey): Promise<{ password: string; accessCode: string }> {
    return serialize(async () => {
        const stored = readConfigFile();
        const history = stored ? usableHistory(stored) ?? [] : [];
        const index = history.findIndex(item => item.domain === domain && item.account === account);
        if (index < 0) return { password: '', accessCode: '' };
        const { password, accessCode } = await readCredentials(HISTORY_CREDENTIALS, history[index], `history[${index}].`, true);
        return { password: plaintextOf(password), accessCode: plaintextOf(accessCode) };
    });
}

/** 删除一条登录历史，不影响当前登录。没有这一条时返回 false。 */
export function removeHistory({ domain, account }: HistoryKey): Promise<boolean> {
    return transaction(false, (state) => {
        const history = state.history ?? [];
        const kept = history.filter(entry => !(entry.item.domain === domain && entry.item.account === account));
        if (kept.length === history.length) return false;
        state.history = kept;
        return true;
    });
}

/** 清空登录历史，不影响当前登录。 */
export function clearHistory(): Promise<void> {
    return transaction(false, (state) => {
        state.history = [];
    }).then(() => undefined);
}
