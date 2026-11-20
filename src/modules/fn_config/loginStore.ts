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

/**
 * open：解开凭据，用于要读明文或写入新凭据的操作，写回时凭据字段总是写出。
 * sealed：凭据保持磁盘值，用于只删登录历史条目的操作，不碰 safeStorage，写回时原样。
 */
type CredentialAccess = 'open' | 'sealed';

interface HistoryEntry {
    /** 磁盘上的这一条，凭据以外的字段原样写回。 */
    item: StoredHistoryItem;
    credentials: Credentials<typeof HISTORY_CREDENTIALS>;
}

interface LoginState {
    access: CredentialAccess;
    found: boolean;
    account?: unknown;
    domain?: unknown;
    useHttps?: unknown;
    credentials: Credentials<typeof LOGIN_CREDENTIALS>;
    history?: HistoryEntry[];
}

/** 当前登录。读出来 token 为空表示已退出登录或凭据解不开。 */
export interface SavedLogin {
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

const isEntry = (item: HistoryKey, { domain, account }: HistoryKey): boolean => item.domain === domain && item.account === account;

const historyOf = (stored: StoredConfig | null): StoredHistoryItem[] => (stored ? usableHistory(stored) ?? [] : []);

// 访问码解不开时过不了网关，token 单独可用也不算已登录。
function visibleToken({ token, accessCode }: LoginState['credentials']): string {
    return 'sealed' in accessCode ? '' : plaintextOf(token);
}

async function readCredentials<Table extends Record<string, LegacyFormat>>(
    table: Table,
    source: Record<string, unknown>,
    label: string,
    access: CredentialAccess,
): Promise<Credentials<Table>> {
    const credentials = {} as Credentials<Table>;
    for (const field of Object.keys(table) as (keyof Table & string)[]) {
        const stored = asString(source[field]);
        if (access === 'sealed') {
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

// sealed 时原来没有这个字段、现在也是空值就不加字段，写回的内容和读到的一样。
function writeCredentials(
    target: Record<string, unknown>,
    credentials: Record<string, Credential>,
    encrypted: Map<string, string>,
    access: CredentialAccess,
): void {
    for (const [field, credential] of Object.entries(credentials)) {
        const value = storedValueOf(credential, encrypted);
        if (access === 'open' || value !== '' || field in target) target[field] = value;
    }
}

async function load(access: CredentialAccess): Promise<LoginState> {
    const stored = readConfigFile();
    const source: StoredConfig = stored ?? {};
    const history = usableHistory(source);
    return {
        access,
        found: stored !== null,
        account: source.account,
        domain: source.domain,
        useHttps: source.useHttps,
        credentials: await readCredentials(LOGIN_CREDENTIALS, source, '', access),
        history: history && await Promise.all(history.map(async (item, index) => ({
            item,
            credentials: await readCredentials(HISTORY_CREDENTIALS, item, `history[${index}].`, access),
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
 * 登录存储唯一的写盘处：先加密所有新明文，加密完成后才重新读文件取设置项，
 * 所以期间同步写入的设置项不会丢。加密失败时不写。
 */
async function commit(state: LoginState): Promise<void> {
    const encrypted = await encryptAll(allCredentials(state).filter(needsEncryption).map(credential => credential.plain));
    const stored: StoredConfig = { ...readConfigFile() };
    stored.account = state.account;
    stored.domain = state.domain;
    writeCredentials(stored, state.credentials, encrypted, state.access);
    stored.useHttps = state.useHttps;
    stored.history = state.history?.map(({ item, credentials }) => {
        const written: Record<string, unknown> = { ...item };
        writeCredentials(written, credentials, encrypted, state.access);
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

/** 改动登录存储的操作都经过这里。change 同步修改读出的状态，返回 false 时不写。 */
function transaction(access: CredentialAccess, change: (state: LoginState) => boolean | void): Promise<boolean> {
    return serialize(async () => {
        const state = await load(access);
        if (change(state) === false) return false;
        await commit(state);
        return true;
    });
}

/**
 * 读取当前登录，必要时把旧格式凭据迁移到安全存储；文件不存在或损坏时返回 null。
 * 迁移失败不影响本次读取，旧值留在磁盘上，下次读取时重试。
 */
export function readCurrentLogin(): Promise<SavedLogin | null> {
    return serialize(async () => {
        const state = await load('open');
        if (!state.found) return null;
        if (allCredentials(state).some(needsEncryption)) {
            await commit(state).catch(() => warnOnce('迁移旧版凭据失败，暂时保留原值'));
        }
        return {
            domain: asString(state.domain),
            account: asString(state.account),
            token: visibleToken(state.credentials),
            accessCode: plaintextOf(state.credentials.accessCode),
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

function addToHistory(state: LoginState, entry: NewHistoryEntry): void {
    const history = (state.history ?? []).filter(existing => !isEntry(existing.item, entry));
    history.unshift({
        item: { domain: entry.domain, account: entry.account, password: '', accessCode: '', useHttps: entry.useHttps || false },
        credentials: { password: { plain: entry.password }, accessCode: { plain: entry.accessCode || '' } },
    });
    while (history.length > HISTORY_LIMIT) {
        history.splice(findEvictionIndex(history), 1);
    }
    state.history = history;
}

/**
 * 保存当前登录；给了 history 就在同一次写入里加进登录历史（去重、最多 5 条），两者要么都写上，要么都没写。
 * 新凭据总是重新加密：安全存储不可用时抛错，文件不变。解不开的旧 token 和访问码被这次的值替换，
 * 所以 token 不能为空，退出登录用 clearToken。
 */
export function saveCurrentLogin(login: SavedLogin, history?: NewHistoryEntry): Promise<void> {
    if (!login.token) return Promise.reject(new Error('保存当前登录需要 token，退出登录用 clearToken'));
    return transaction('open', (state) => {
        state.account = login.account;
        state.domain = login.domain;
        state.useHttps = login.useHttps;
        state.credentials = { token: { plain: login.token }, accessCode: { plain: login.accessCode } };
        if (history) addToHistory(state, history);
    }).then(() => undefined);
}

/**
 * 退出登录：清空 token，保留账号、地址、访问码和 HTTPS 设置。token 本身解不开时原样留着，
 * 由用户之后的登录替换。没有可清的内容时不写文件，返回 false。
 */
export function clearToken(): Promise<boolean> {
    return transaction('open', (state) => {
        if (!state.found || !(visibleToken(state.credentials) || state.domain)) return false;
        state.account = asString(state.account);
        state.domain = asString(state.domain);
        state.useHttps = state.useHttps === true;
        if ('plain' in state.credentials.token) state.credentials.token = NO_CREDENTIAL;
        return true;
    });
}

/** 登录历史列表，不解密、不含凭据。读盘失败时抛出。 */
export function listHistory(): HistoryListing[] {
    return historyOf(readConfigFile()).map(item => ({
        domain: item.domain,
        account: item.account,
        useHttps: item.useHttps === true,
    }));
}

/** 一条登录历史的凭据。找不到或解不开时读出来是空值，由用户手动输入。 */
export function historyCredentials(key: HistoryKey): Promise<{ password: string; accessCode: string }> {
    return serialize(async () => {
        const history = historyOf(readConfigFile());
        const index = history.findIndex(item => isEntry(item, key));
        if (index < 0) return { password: '', accessCode: '' };
        const { password, accessCode } = await readCredentials(HISTORY_CREDENTIALS, history[index], `history[${index}].`, 'open');
        return { password: plaintextOf(password), accessCode: plaintextOf(accessCode) };
    });
}

/** 删除一条登录历史，不影响当前登录。没有这一条时返回 false。 */
export function removeHistory(key: HistoryKey): Promise<boolean> {
    return transaction('sealed', (state) => {
        const history = state.history ?? [];
        const kept = history.filter(entry => !isEntry(entry.item, key));
        if (kept.length === history.length) return false;
        state.history = kept;
        return true;
    });
}

/** 清空登录历史，不影响当前登录。 */
export function clearHistory(): Promise<void> {
    return transaction('sealed', (state) => {
        state.history = [];
    }).then(() => undefined);
}
