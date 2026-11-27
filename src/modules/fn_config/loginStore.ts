import { type ConfigValues, configSection, warnOnce } from './configFile';
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

const HISTORY_LIMIT = 5;

const STORED_KEYS = ['account', 'domain', 'token', 'accessCode', 'useHttps', 'history'] as const;

const section = configSection(STORED_KEYS);

type StoredLogin = ConfigValues<typeof STORED_KEYS[number]>;

interface StoredHistoryItem extends Record<string, unknown> {
    domain: string;
    account: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHistoryItem(item: unknown): item is StoredHistoryItem {
    return isObject(item) && typeof item.domain === 'string' && typeof item.account === 'string';
}

function hasUnusableHistory(stored: StoredLogin): boolean {
    return stored.history !== undefined && stored.history !== null && !(Array.isArray(stored.history) && stored.history.every(isHistoryItem));
}

function usableHistory(stored: StoredLogin): StoredHistoryItem[] | undefined {
    const historyUnusable = hasUnusableHistory(stored);
    if (historyUnusable) warnOnce('配置里的 history 含无法使用的内容，读取时已跳过');
    return Array.isArray(stored.history) ? stored.history.filter(isHistoryItem) : historyUnusable ? [] : undefined;
}

const LOGIN_CREDENTIALS = { token: 'plaintext', accessCode: 'plaintext' } as const satisfies Record<string, LegacyFormat>;
const HISTORY_CREDENTIALS = { password: 'legacyPassword', accessCode: 'plaintext' } as const satisfies Record<string, LegacyFormat>;

type Credentials<Table> = { -readonly [Field in keyof Table]: Credential };

type CredentialAccess = 'open' | 'sealed';

interface HistoryEntry {
    item: StoredHistoryItem;
    credentials: Credentials<typeof HISTORY_CREDENTIALS>;
}

interface LoginState {
    access: CredentialAccess;
    found: boolean;
    stored: StoredLogin;
    account?: unknown;
    domain?: unknown;
    useHttps?: unknown;
    credentials: Credentials<typeof LOGIN_CREDENTIALS>;
    history?: HistoryEntry[];
}

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

export interface HistoryListing extends HistoryKey {
    useHttps: boolean;
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

const isEntry = (item: HistoryKey, { domain, account }: HistoryKey): boolean => item.domain === domain && item.account === account;

const historyOf = (stored: StoredLogin | null): StoredHistoryItem[] => (stored ? usableHistory(stored) ?? [] : []);

function tokenUnlessAccessCodeSealed({ token, accessCode }: LoginState['credentials']): string {
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
        if ('sealed' in credential) warnOnce(`凭据解密失败，按未登录处理: ${label}${field}`);
        credentials[field] = credential;
    }
    return credentials;
}

function writeCredentials(
    target: Record<string, unknown>,
    credentials: Record<string, Credential>,
    encrypted: Map<string, string>,
    access: CredentialAccess,
): void {
    for (const [field, credential] of Object.entries(credentials)) {
        const value = storedValueOf(credential, encrypted);
        const sealedFieldStaysAbsent = access === 'sealed' && value === '' && !(field in target);
        if (!sealedFieldStaysAbsent) target[field] = value;
    }
}

async function load(access: CredentialAccess): Promise<LoginState> {
    const stored = section.read();
    const source: StoredLogin = stored ?? {};
    const history = usableHistory(source);
    return {
        access,
        found: stored !== null,
        stored: source,
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

async function commit(state: LoginState): Promise<void> {
    const encrypted = await encryptAll(allCredentials(state).filter(needsEncryption).map(credential => credential.plain));
    if (hasUnusableHistory(state.stored)) warnOnce('配置里的 history 含无法使用的内容，写入时已丢弃');
    const stored: StoredLogin = { ...state.stored };
    stored.account = state.account;
    stored.domain = state.domain;
    writeCredentials(stored, state.credentials, encrypted, state.access);
    stored.useHttps = state.useHttps;
    stored.history = state.history?.map(({ item, credentials }) => {
        const written: Record<string, unknown> = { ...item };
        writeCredentials(written, credentials, encrypted, state.access);
        return written;
    });
    section.replace(stored);
}

let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
}

type Change = 'write' | 'unchanged';

function transaction(access: CredentialAccess, change: (state: LoginState) => Change): Promise<Change> {
    return serialize(async () => {
        const state = await load(access);
        if (change(state) === 'unchanged') return 'unchanged';
        await commit(state);
        return 'write';
    });
}

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
            token: tokenUnlessAccessCodeSealed(state.credentials),
            accessCode: plaintextOf(state.credentials.accessCode),
            useHttps: state.useHttps === true,
        };
    });
}

const hasUndecryptable = (entry: HistoryEntry): boolean => Object.values(entry.credentials).some(credential => 'sealed' in credential);

function indexToEvict(history: HistoryEntry[]): number {
    const newestIndex = 0;
    for (let index = history.length - 1; index > newestIndex; index--) {
        if (!hasUndecryptable(history[index])) return index;
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
        history.splice(indexToEvict(history), 1);
    }
    state.history = history;
}

function writeLogin(login: SavedLogin, history: NewHistoryEntry | null): Promise<void> {
    if (!login.token) return Promise.reject(new Error('保存当前登录需要 token，退出登录用 clearToken'));
    return transaction('open', (state) => {
        state.account = login.account;
        state.domain = login.domain;
        state.useHttps = login.useHttps;
        state.credentials = { token: { plain: login.token }, accessCode: { plain: login.accessCode } };
        if (history) addToHistory(state, history);
        return 'write';
    }).then(() => undefined);
}

export function saveCurrentLogin(login: SavedLogin): Promise<void> {
    return writeLogin(login, null);
}

export function saveNewLogin(login: SavedLogin, historyEntry: NewHistoryEntry): Promise<void> {
    return writeLogin(login, historyEntry);
}

export function clearToken(): Promise<boolean> {
    return transaction('open', (state) => {
        if (!state.found || !(tokenUnlessAccessCodeSealed(state.credentials) || state.domain)) return 'unchanged';
        state.account = asString(state.account);
        state.domain = asString(state.domain);
        state.useHttps = state.useHttps === true;
        if ('plain' in state.credentials.token) state.credentials.token = NO_CREDENTIAL;
        return 'write';
    }).then(change => change === 'write');
}

export function listHistory(): HistoryListing[] {
    return historyOf(section.read()).map(item => ({
        domain: item.domain,
        account: item.account,
        useHttps: item.useHttps === true,
    }));
}

export function historyCredentials(key: HistoryKey): Promise<{ password: string; accessCode: string }> {
    return serialize(async () => {
        const history = historyOf(section.read());
        const index = history.findIndex(item => isEntry(item, key));
        if (index < 0) return { password: '', accessCode: '' };
        const { password, accessCode } = await readCredentials(HISTORY_CREDENTIALS, history[index], `history[${index}].`, 'open');
        return { password: plaintextOf(password), accessCode: plaintextOf(accessCode) };
    });
}

export function removeHistory(key: HistoryKey): Promise<boolean> {
    return transaction('sealed', (state) => {
        const history = state.history ?? [];
        const kept = history.filter(entry => !isEntry(entry.item, key));
        if (kept.length === history.length) return 'unchanged';
        state.history = kept;
        return 'write';
    }).then(change => change === 'write');
}

export function clearHistory(): Promise<void> {
    return transaction('sealed', (state) => {
        state.history = [];
        return 'write';
    }).then(() => undefined);
}
