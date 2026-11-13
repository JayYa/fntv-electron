import * as fs from 'fs';
import * as path from 'node:path';
import { app } from 'electron';
import { USER_DATA_PATH } from '../../public/constants';
import { isMpvPlaybackEnabled } from './playbackPreference';
import { hasUnusableHistory, isHistoryItem, parseConfig, replaceConfig, warnOnce } from './configFile';
import {
    type CredentialField,
    type PreparedCredentials,
    decryptCredential,
    encryptCredential,
    prepareCredentials,
} from './credentialCrypto';

const HISTORY_LIMIT = 5;

// 解不开的凭据在内存里是空值，磁盘上的原值挂在这个 symbol 下。对象展开和 filter 会带上它，
// JSON 和 IPC 不带，所以 read-modify-write 不需要知道它的存在，writeConfig 负责原样写回。
const RETAINED = Symbol('retainedCredentials');

app.setPath('userData', USER_DATA_PATH);

/**
 * 配置接口
 */
export interface Config {
    account?: string;
    domain?: string;
    token?: string;
    accessCode?: string;
    useHttps?: boolean;
    history?: HistoryItem[];
    downloadProxyEnabled?: boolean;
    downloadProxy?: string;
    hideOriginalPlayButton?: boolean;
    macCloseAction?: 'minimize' | 'quit' | 'ask';
    trayNotificationShown?: boolean;
    nasProxyEnabled?: boolean;
    mpvPlayerPath?: string;
    mpvVolume?: number;
    exitMode?: 'direct' | 'minimize' | 'ask';
    [RETAINED]?: { token?: string; accessCode?: string };
}

/**
 * 历史记录项接口
 */
export interface HistoryItem {
    domain: string;
    account: string;
    password: string;
    accessCode?: string;
    useHttps?: boolean;
    [RETAINED]?: { password?: string; accessCode?: string };
}

/**
 * 保存配置参数接口
 */
export interface SaveConfigParams {
    account: string;
    domain: string;
    token: string;
    accessCode?: string;
    useHttps?: boolean;
}

/**
 * 添加历史记录参数接口
 */
export interface AddHistoryParams {
    domain: string;
    account: string;
    password: string;
    accessCode?: string;
    useHttps?: boolean;
}

/**
 * 删除历史记录参数接口
 */
export interface DeleteHistoryParams {
    domain: string;
    account: string;
}

/**
 * 下载代理配置接口
 */
export interface AppDownloadProxyConfig {
    enabled: boolean;
    proxyUrl: string;
}

/**
 * 设置下载代理配置参数接口
 */
export interface SetAppDownloadProxyConfigParams {
    enabled?: boolean;
    proxyUrl?: string;
}

function getConfigPath(): string {
    const dir = app.getPath('userData');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, 'config.json');
}

// 新增凭据字段时在这里登记，decodeConfig 和 writeConfig 两边也要用 readCredential、storeCredential。
function credentialFields(stored: Config): CredentialField[] {
    const history = Array.isArray(stored.history) ? stored.history.filter(isHistoryItem) : [];
    return [
        { value: stored.token || '', isLegacyPassword: false },
        { value: stored.accessCode || '', isLegacyPassword: false },
        ...history.flatMap(item => [
            { value: item.password, isLegacyPassword: true },
            { value: item.accessCode || '', isLegacyPassword: false },
        ]),
    ].filter(field => typeof field.value === 'string' && field.value !== '');
}

function readCredential(field: string, value: string, isLegacyPassword: boolean, prepared: PreparedCredentials): { value: string; rewrite: boolean; retained?: string } {
    try {
        return decryptCredential(value, isLegacyPassword, prepared);
    } catch {
        // 只记字段名：错误对象可能带密文。
        warnOnce(`凭据解密失败，按未登录处理: ${field}`);
        return { value: '', rewrite: false, retained: value };
    }
}

// 空值不算新凭据，解不开的原值要留到用户重新登录。
function storeCredential(value: string | undefined, retained: string | undefined, prepared: PreparedCredentials): string {
    return value ? encryptCredential(value, prepared) : retained ?? '';
}

function writeConfig(config: Config, prepared: PreparedCredentials): void {
    const stored: Config = {
        ...config,
        token: storeCredential(config.token, config[RETAINED]?.token, prepared),
        accessCode: storeCredential(config.accessCode, config[RETAINED]?.accessCode, prepared),
        history: config.history?.map(item => ({
            ...item,
            password: storeCredential(item.password, item[RETAINED]?.password, prepared),
            accessCode: storeCredential(item.accessCode, item[RETAINED]?.accessCode, prepared),
        })),
    };
    writeStoredConfig(stored);
}

function writeStoredConfig(stored: Config): void {
    replaceConfig(getConfigPath(), JSON.stringify(stored, null, 2));
}

// 文件不存在或内容损坏时返回 null。
function readConfigFile(): Config | null {
    const p = getConfigPath();
    if (!fs.existsSync(p)) return null;
    try {
        return parseConfig(fs.readFileSync(p, 'utf-8'));
    } catch (error) {
        if (error instanceof SyntaxError) return null;
        throw error;
    }
}

function usableHistory(stored: Config): HistoryItem[] | undefined {
    const historyUnusable = hasUnusableHistory(stored);
    if (historyUnusable) warnOnce('配置里的 history 含无法使用的内容，读取时已跳过');
    return Array.isArray(stored.history) ? stored.history.filter(isHistoryItem) : historyUnusable ? [] : undefined;
}

/**
 * 设置项的读写不经过 safeStorage：凭据保持密文，原样写回。
 * 文件不存在或内容损坏时返回空配置，写入时 replaceConfig 会先备份损坏的文件。
 */
function readStoredConfig(): Config {
    const stored = readConfigFile();
    // history 为 null 时得到 undefined，写回时这个字段被去掉。
    return stored ? { ...stored, history: usableHistory(stored) } : {};
}

function decodeConfig(stored: Config, prepared: PreparedCredentials): { config: Config; needsMigration: boolean } {
    const token = readCredential('token', stored.token || '', false, prepared);
    const accessCode = readCredential('accessCode', stored.accessCode || '', false, prepared);
    // 访问码解不开时过不了网关，token 单独可用也不算已登录，同样隐藏并保留原值。
    const accessCodeFailed = accessCode.retained !== undefined;
    let needsMigration = accessCode.rewrite || (token.rewrite && !accessCodeFailed);
    const config: Config = {
        ...stored,
        token: accessCodeFailed ? '' : token.value,
        accessCode: accessCode.value,
        [RETAINED]: {
            token: accessCodeFailed ? stored.token : token.retained,
            accessCode: accessCode.retained,
        },
        history: usableHistory(stored)?.map((item, index) => {
            const password = readCredential(`history[${index}].password`, item.password, true, prepared);
            const historyAccessCode = readCredential(`history[${index}].accessCode`, item.accessCode || '', false, prepared);
            needsMigration ||= password.rewrite || historyAccessCode.rewrite;
            return {
                ...item,
                password: password.value,
                accessCode: historyAccessCode.value,
                [RETAINED]: {
                    password: password.retained,
                    accessCode: historyAccessCode.retained,
                },
            };
        }),
    };
    return { config, needsMigration };
}

// 凭据操作按调用顺序逐个执行：上一个的加解密完成之前，下一个不读磁盘。
let credentialQueue: Promise<unknown> = Promise.resolve();

function serializeCredentialTask<T>(task: () => Promise<T>): Promise<T> {
    const run = credentialQueue.then(task, task);
    credentialQueue = run.catch(() => undefined);
    return run;
}

/**
 * 读出带明文凭据的配置。forWrite 见 prepareCredentials：给了就同时准备好写入。
 * 加解密都完成后才重新读文件，所以期间同步写入的设置项不会丢。文件不存在或损坏时 config 为 null。
 */
async function decodeCurrentConfig(forWrite?: (string | undefined)[]): Promise<{ config: Config | null; prepared: PreparedCredentials; needsMigration: boolean }> {
    const prepared = await prepareCredentials(credentialFields(readConfigFile() ?? {}), forWrite);
    const stored = readConfigFile();
    if (!stored) return { config: null, prepared, needsMigration: false };
    return { ...decodeConfig(stored, prepared), prepared };
}

// 读取配置（凭据已解密），必要时把旧格式凭据迁移到安全存储。只读不加密，要迁移时再准备一次写入。
async function loadConfig(): Promise<Config | null> {
    const read = await decodeCurrentConfig();
    if (!read.config || !read.needsMigration) return read.config;
    const { config, prepared, needsMigration } = await decodeCurrentConfig([]);
    if (config && needsMigration && prepared.encryptionAvailable) {
        try {
            writeConfig(config, prepared);
        } catch {
            // 迁移失败不影响本次读取，旧值留在磁盘上，下次读取时重试。
            warnOnce('迁移旧版凭据失败，暂时保留原值');
        }
    }
    return config;
}

// 读取配置
export function readConfig(): Promise<Config | null> {
    return serializeCredentialTask(loadConfig);
}

function applySave(config: Config, { account, domain, token, accessCode, useHttps }: SaveConfigParams): void {
    config.account = account;
    config.domain = domain;
    config.token = token;
    if (accessCode !== undefined) config.accessCode = accessCode;
    // 带新 token 的保存是重新登录，这次的访问码就算为空也要替换解不开的旧值，否则每次启动都回登录页。
    if (token && accessCode !== undefined) delete config[RETAINED]?.accessCode;
    config.useHttps = useHttps || false;
}

// 保存配置（账号、域名、token、HTTPS设置）
export function saveConfig(params: SaveConfigParams): Promise<void> {
    return serializeCredentialTask(async () => {
        const { config, prepared } = await decodeCurrentConfig([params.token, params.accessCode]);
        const updated: Config = config || {};
        applySave(updated, params);
        writeConfig(updated, prepared);
    });
}

// 退出登录：清空 token，保留账号、域名和 HTTPS 设置。读和写在同一个凭据操作里，
// 之后排队的登录保存不会被覆盖。没有可清的内容时不写文件，返回 false。
export function clearSavedToken(): Promise<boolean> {
    return serializeCredentialTask(async () => {
        const { config, prepared } = await decodeCurrentConfig();
        if (!config || !(config.token || config.domain)) return false;
        applySave(config, {
            account: config.account || '',
            domain: config.domain || '',
            token: '',
            useHttps: config.useHttps,
        });
        writeConfig(config, prepared);
        return true;
    });
}

// 从最旧的开始淘汰，解不开的留到最后：密钥恢复后它们还能用。下标 0 是刚加的，不淘汰。
function findEvictionIndex(history: HistoryItem[]): number {
    for (let index = history.length - 1; index > 0; index--) {
        const { password, accessCode } = history[index][RETAINED] ?? {};
        if (password === undefined && accessCode === undefined) return index;
    }
    return history.length - 1;
}

// 添加历史记录（域名、账号、加密密码、HTTPS设置）
export function addHistory({ domain, account, password, accessCode, useHttps }: AddHistoryParams): Promise<void> {
    return serializeCredentialTask(async () => {
        const { config: current, prepared } = await decodeCurrentConfig([password, accessCode]);
        const config: Config = current || {};
        config.history = config.history || [];
        // 移除重复项
        config.history = config.history.filter(
            item => !(item.domain === domain && item.account === account)
        );
        // 添加新项
        config.history.unshift({
            domain,
            account,
            password,
            accessCode: accessCode || '',
            useHttps: useHttps || false
        });
        // 限制最多数量
        while (config.history.length > HISTORY_LIMIT) {
            config.history.splice(findEvictionIndex(config.history), 1);
        }
        writeConfig(config, prepared);
    });
}

// 获取历史记录（解密密码）
export function getHistory(): Promise<HistoryItem[]> {
    return serializeCredentialTask(async () => {
        const config: Config = (await loadConfig()) || {};
        if (!config.history) return [];
        return config.history.map(item => ({
            domain: item.domain,
            account: item.account,
            password: item.password,
            accessCode: item.accessCode || '',
            useHttps: item.useHttps || false
        }));
    });
}

// 获取一条历史记录的凭据。找不到或解不开时读出来是空值，由用户手动输入。
export async function getHistoryCredentials({ domain, account }: DeleteHistoryParams): Promise<{ password: string; accessCode: string }> {
    const item = (await getHistory()).find(entry => entry.domain === domain && entry.account === account);
    return { password: item?.password || '', accessCode: item?.accessCode || '' };
}

// 清除历史记录
export function clearHistory(): void {
    const config = readStoredConfig();
    config.history = [];
    writeStoredConfig(config);
}

// 删除单个历史记录
export function deleteHistoryItem({ domain, account }: DeleteHistoryParams): boolean {
    const config = readStoredConfig();
    if (!config.history) return false;

    const originalLength = config.history.length;
    config.history = config.history.filter(
        item => !(item.domain === domain && item.account === account)
    );

    if (config.history.length < originalLength) {
        writeStoredConfig(config);
        return true;
    }
    return false;
}

/** 应用更新下载加速的默认中转地址，主进程和登录页都从这里取 */
export const DEFAULT_DOWNLOAD_PROXY_URL = 'https://gh-proxy.com/';

// 旧版默认中转地址。旧版设置面板保存时会把它写进配置，读到它就当作没自定义
const LEGACY_DEFAULT_DOWNLOAD_PROXY_URL = 'https://ghfast.top';

// 获取下载代理配置。没存过、存的是空白或旧版默认地址时返回默认地址，配置文件不改
export function getAppDownloadProxyConfig(): AppDownloadProxyConfig {
    const config = readStoredConfig();
    const stored = config.downloadProxy ?? '';
    const normalized = stored.trim().replace(/\/$/, '');
    const isCustom = normalized !== '' && normalized !== LEGACY_DEFAULT_DOWNLOAD_PROXY_URL;
    return {
        enabled: config.downloadProxyEnabled === true, // 默认关闭，只有用户显式开启过才用
        proxyUrl: isCustom ? stored : DEFAULT_DOWNLOAD_PROXY_URL
    };
}

// 设置下载代理配置
export function setAppDownloadProxyConfig({ enabled = false, proxyUrl = DEFAULT_DOWNLOAD_PROXY_URL }: SetAppDownloadProxyConfigParams = {}): void {
    const config = readStoredConfig();
    config.downloadProxyEnabled = enabled;
    config.downloadProxy = proxyUrl;
    writeStoredConfig(config);
}

// 获取是否启用 MPV 播放接管（沿用旧字段以兼容已有配置）
export function getHideOriginalPlayButton(): boolean {
    const config = readStoredConfig();
    return isMpvPlaybackEnabled(config.hideOriginalPlayButton);
}

// 设置是否启用 MPV 播放接管
export function setHideOriginalPlayButton(enabled: boolean): void {
    const config = readStoredConfig();
    config.hideOriginalPlayButton = enabled;
    writeStoredConfig(config);
}

// 获取NAS 中转开关
export function getNasProxyEnabled(): boolean {
    const config = readStoredConfig();
    return config.nasProxyEnabled === true; // 默认关闭
}

// 设置NAS 中转开关
export function setNasProxyEnabled(enabled: boolean): void {
    const config = readStoredConfig();
    config.nasProxyEnabled = enabled;
    writeStoredConfig(config);
}

// 获取 macOS 关闭行为偏好
export function getMacCloseAction(): 'minimize' | 'quit' | 'ask' {
    const config = readStoredConfig();
    return config.macCloseAction || 'ask';
}

// 设置 macOS 关闭行为偏好
export function setMacCloseAction(action: 'minimize' | 'quit' | 'ask'): void {
    const config = readStoredConfig();
    config.macCloseAction = action;
    writeStoredConfig(config);
}

// 获取托盘通知是否已显示过
export function getTrayNotificationShown(): boolean {
    const config = readStoredConfig();
    return config.trayNotificationShown || false;
}

// 设置托盘通知已显示状态
export function setTrayNotificationShown(shown: boolean): void {
    const config = readStoredConfig();
    config.trayNotificationShown = shown;
    writeStoredConfig(config);
}

// 获取MPV播放器路径配置
export function getMpvPlayerPath(): string | undefined {
    const config = readStoredConfig();
    return config.mpvPlayerPath;
}

// 设置MPV播放器路径配置
export function setMpvPlayerPath(path: string | null): void {
    const config = readStoredConfig();
    if (path === null || path === '') {
        delete config.mpvPlayerPath; // 清空配置
    } else {
        config.mpvPlayerPath = path;
    }
    writeStoredConfig(config);
}

export function getMpvVolume(): number {
    const volume = readStoredConfig().mpvVolume;
    return typeof volume === 'number' && Number.isFinite(volume)
        ? Math.min(100, Math.max(0, Math.round(volume)))
        : 70;
}

export function setMpvVolume(volume: number): void {
    if (!Number.isFinite(volume)) {
        throw new Error('MPV音量必须是有限数值');
    }

    const config = readStoredConfig();
    config.mpvVolume = Math.min(100, Math.max(0, Math.round(volume)));
    writeStoredConfig(config);
}

// 向后兼容的函数
export function getAppDownloadProxyUrl(): string {
    return getAppDownloadProxyConfig().proxyUrl;
}

export function setAppDownloadProxyUrl(proxyUrl: string): void {
    const current = getAppDownloadProxyConfig();
    setAppDownloadProxyConfig({ enabled: current.enabled, proxyUrl });
}

export function getExitMode(): 'direct' | 'minimize' | 'ask' {
    return readStoredConfig().exitMode ?? 'ask';
}

export function setExitMode(mode: 'direct' | 'minimize' | 'ask'): void {
    const config = readStoredConfig();
    config.exitMode = mode;
    writeStoredConfig(config);
}
