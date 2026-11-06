import * as fs from 'fs';
import * as path from 'node:path';
import * as crypto from 'crypto';
import { app, safeStorage } from 'electron';
import { USER_DATA_PATH } from '../../public/constants';
import { isMpvPlaybackEnabled } from './playbackPreference';

const HISTORY_LIMIT = 5;
const CONFIG_BACKUP_LIMIT = 3;
const ENCRYPTION_KEY = 'U2XDcFsV6rdTE9wB5ZHvy6BW9hBTKJ1H'; // 32 chars for aes-256
const IV = Buffer.alloc(16, 0); // Initialization vector
const SAFE_STORAGE_PREFIX = 'safe-storage:v1:';

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
export interface DownloadProxyConfig {
    enabled: boolean;
    proxyUrl: string;
}

/**
 * 设置下载代理配置参数接口
 */
export interface SetDownloadProxyConfigParams {
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

// 仅用于读取旧版本固定密钥加密的密码。
function decryptLegacyPassword(encrypted: string): string {
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), IV);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

function encryptCredential(value: string): string {
    if (!value) return '';
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('操作系统安全存储不可用，无法保存登录凭据');
    }
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
        throw new Error('Linux 系统未提供可用的密钥环，拒绝以明文方式保存登录凭据');
    }
    return SAFE_STORAGE_PREFIX + safeStorage.encryptString(value).toString('base64');
}

function decryptCredential(value: string, isLegacyPassword: boolean): { value: string; legacy: boolean } {
    if (!value) return { value: '', legacy: false };
    if (value.startsWith(SAFE_STORAGE_PREFIX)) {
        return {
            value: safeStorage.decryptString(Buffer.from(value.slice(SAFE_STORAGE_PREFIX.length), 'base64')),
            legacy: false,
        };
    }
    return {
        value: isLegacyPassword ? decryptLegacyPassword(value) : value,
        legacy: true,
    };
}

// readConfig 被频繁调用，同一条只记一次。
const loggedWarnings = new Set<string>();

function warnOnce(message: string): void {
    if (loggedWarnings.has(message)) return;
    loggedWarnings.add(message);
    // 本模块加载时才设置 userData，静态引入会让 logger 先用默认目录初始化。
    (require('../logger') as typeof import('../logger')).warn(message);
}

function readCredential(field: string, value: string, isLegacyPassword: boolean): { value: string; legacy: boolean; retained?: string } {
    try {
        return decryptCredential(value, isLegacyPassword);
    } catch {
        // 只记字段名：错误对象可能带密文。
        warnOnce(`凭据解密失败，按未登录处理: ${field}`);
        return { value: '', legacy: false, retained: value };
    }
}

// 空值不算新凭据，解不开的原值要留到用户重新登录。
function storeCredential(value: string | undefined, retained: string | undefined): string {
    return value ? encryptCredential(value) : retained ?? '';
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 顶层不是对象的 JSON 和语法错误一样算损坏，读取和备份判定都走 SyntaxError 这条路。
function parseConfig(text: string): Config {
    const stored: unknown = JSON.parse(text);
    if (!isObject(stored)) throw new SyntaxError('配置顶层不是对象');
    return stored;
}

function isHistoryItem(item: unknown): item is HistoryItem {
    return isObject(item) && typeof item.domain === 'string' && typeof item.account === 'string';
}

function hasUnusableHistory(stored: { history?: unknown }): boolean {
    return stored.history !== undefined && stored.history !== null && !(Array.isArray(stored.history) && stored.history.every(isHistoryItem));
}

// 这样的文件读出来会丢内容，被替换前要留底。
function isDamaged(configPath: string): boolean {
    if (!fs.existsSync(configPath)) return false;
    const text = fs.readFileSync(configPath, 'utf-8');
    try {
        return hasUnusableHistory(parseConfig(text));
    } catch {
        return true;
    }
}

// 用复制而不是改名：写入失败时 config.json 还在。备份含密文，只记文件名。
function backupConfig(configPath: string): void {
    const prefix = `${path.basename(configPath)}.corrupt-`;
    for (let stamp = Date.now(); ; stamp++) {
        try {
            fs.copyFileSync(configPath, path.join(path.dirname(configPath), prefix + stamp), fs.constants.COPYFILE_EXCL);
            warnOnce(`配置文件内容损坏，替换前已备份为 ${prefix + stamp}`);
            break;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
    }
    try {
        const dir = path.dirname(configPath);
        const backups = fs.readdirSync(dir).filter(name => name.startsWith(prefix)).sort();
        backups.slice(0, -CONFIG_BACKUP_LIMIT).forEach(name => fs.rmSync(path.join(dir, name)));
    } catch {
        // 备份已经落盘，清理旧备份失败不影响这次写入。
        warnOnce('清理旧配置备份失败');
    }
}

// 先写完临时文件再备份：写不下去时不占备份名额。rename 之前 config.json 始终是旧内容。
function replaceConfig(configPath: string, content: string): void {
    const tempPath = `${configPath}.tmp`;
    const mode = fs.existsSync(configPath) ? fs.statSync(configPath).mode : undefined;
    try {
        const fd = fs.openSync(tempPath, 'w', mode);
        try {
            fs.writeFileSync(fd, content);
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        if (isDamaged(configPath)) backupConfig(configPath);
        fs.renameSync(tempPath, configPath);
    } catch (error) {
        fs.rmSync(tempPath, { force: true });
        throw error;
    }
}

function writeConfig(config: Config): void {
    const stored: Config = {
        ...config,
        token: storeCredential(config.token, config[RETAINED]?.token),
        accessCode: storeCredential(config.accessCode, config[RETAINED]?.accessCode),
        history: config.history?.map(item => ({
            ...item,
            password: storeCredential(item.password, item[RETAINED]?.password),
            accessCode: storeCredential(item.accessCode, item[RETAINED]?.accessCode),
        })),
    };
    replaceConfig(getConfigPath(), JSON.stringify(stored, null, 2));
}

// 读取配置
export function readConfig(): Config | null {
    const p = getConfigPath();
    if (fs.existsSync(p)) {
        try {
            const stored = parseConfig(fs.readFileSync(p, 'utf-8'));
            const token = readCredential('token', stored.token || '', false);
            const accessCode = readCredential('accessCode', stored.accessCode || '', false);
            // 访问码解不开时过不了网关，token 单独可用也不算已登录，同样隐藏并保留原值。
            const accessCodeFailed = accessCode.retained !== undefined;
            let needsMigration = accessCode.legacy || (token.legacy && !accessCodeFailed);
            const historyUnusable = hasUnusableHistory(stored);
            if (historyUnusable) warnOnce('配置里的 history 含无法使用的内容，读取时已跳过');
            const history = Array.isArray(stored.history) ? stored.history.filter(isHistoryItem) : historyUnusable ? [] : undefined;
            const config: Config = {
                ...stored,
                token: accessCodeFailed ? '' : token.value,
                accessCode: accessCode.value,
                [RETAINED]: {
                    token: accessCodeFailed ? stored.token : token.retained,
                    accessCode: accessCode.retained,
                },
                history: history?.map((item, index) => {
                    const password = readCredential(`history[${index}].password`, item.password, true);
                    const historyAccessCode = readCredential(`history[${index}].accessCode`, item.accessCode || '', false);
                    needsMigration ||= password.legacy || historyAccessCode.legacy;
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

            if (needsMigration && safeStorage.isEncryptionAvailable()) {
                try {
                    writeConfig(config);
                } catch {
                    // 迁移失败不影响本次读取，旧值留在磁盘上，下次读取时重试。
                    warnOnce('迁移旧版凭据失败，暂时保留原值');
                }
            }
            return config;
        } catch (error) {
            if (error instanceof SyntaxError) return null;
            throw error;
        }
    }
    return null;
}

// 保存配置（账号、域名、token、HTTPS设置）
export function saveConfig({ account, domain, token, accessCode, useHttps }: SaveConfigParams): void {
    const config: Config = readConfig() || {};
    config.account = account;
    config.domain = domain;
    config.token = token;
    if (accessCode !== undefined) config.accessCode = accessCode;
    // 带新 token 的保存是重新登录，这次的访问码就算为空也要替换解不开的旧值，否则每次启动都回登录页。
    if (token && accessCode !== undefined) delete config[RETAINED]?.accessCode;
    config.useHttps = useHttps || false;
    writeConfig(config);
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
export function addHistory({ domain, account, password, accessCode, useHttps }: AddHistoryParams): void {
    const config: Config = readConfig() || {};
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
    writeConfig(config);
}

// 获取历史记录（解密密码）
export function getHistory(): HistoryItem[] {
    const config: Config = readConfig() || {};
    if (!config.history) return [];
    return config.history.map(item => ({
        domain: item.domain,
        account: item.account,
        password: item.password,
        accessCode: item.accessCode || '',
        useHttps: item.useHttps || false
    }));
}

// 获取一条历史记录的凭据。找不到或解不开时读出来是空值，由用户手动输入。
export function getHistoryCredentials({ domain, account }: DeleteHistoryParams): { password: string; accessCode: string } {
    const item = getHistory().find(entry => entry.domain === domain && entry.account === account);
    return { password: item?.password || '', accessCode: item?.accessCode || '' };
}

// 清除历史记录
export function clearHistory(): void {
    const config: Config = readConfig() || {};
    config.history = [];
    writeConfig(config);
}

// 删除单个历史记录
export function deleteHistoryItem({ domain, account }: DeleteHistoryParams): boolean {
    const config: Config = readConfig() || {};
    if (!config.history) return false;
    
    const originalLength = config.history.length;
    config.history = config.history.filter(
        item => !(item.domain === domain && item.account === account)
    );
    
    if (config.history.length < originalLength) {
        writeConfig(config);
        return true;
    }
    return false;
}

// 获取下载代理配置
export function getDownloadProxyConfig(): DownloadProxyConfig {
    const config: Config = readConfig() || {};
    return {
        enabled: config.downloadProxyEnabled !== false, // 默认开启
        proxyUrl: config.downloadProxy || 'https://ghfast.top'
    };
}

// 设置下载代理配置
export function setDownloadProxyConfig({ enabled = true, proxyUrl = 'https://ghfast.top' }: SetDownloadProxyConfigParams = {}): void {
    const config: Config = readConfig() || {};
    config.downloadProxyEnabled = enabled;
    config.downloadProxy = proxyUrl;
    writeConfig(config);
}

// 获取是否启用 MPV 播放接管（沿用旧字段以兼容已有配置）
export function getHideOriginalPlayButton(): boolean {
    const config: Config = readConfig() || {};
    return isMpvPlaybackEnabled(config.hideOriginalPlayButton);
}

// 设置是否启用 MPV 播放接管
export function setHideOriginalPlayButton(enabled: boolean): void {
    const config: Config = readConfig() || {};
    config.hideOriginalPlayButton = enabled;
    writeConfig(config);
}

// 获取NAS本地网盘代理配置
export function getNasProxyEnabled(): boolean {
    const config: Config = readConfig() || {};
    return config.nasProxyEnabled === true; // 默认关闭
}

// 设置NAS本地网盘代理配置
export function setNasProxyEnabled(enabled: boolean): void {
    const config: Config = readConfig() || {};
    config.nasProxyEnabled = enabled;
    writeConfig(config);
}

// 获取 macOS 关闭行为偏好
export function getMacCloseAction(): 'minimize' | 'quit' | 'ask' {
    const config: Config = readConfig() || {};
    return config.macCloseAction || 'ask';
}

// 设置 macOS 关闭行为偏好
export function setMacCloseAction(action: 'minimize' | 'quit' | 'ask'): void {
    const config: Config = readConfig() || {};
    config.macCloseAction = action;
    writeConfig(config);
}

// 获取托盘通知是否已显示过
export function getTrayNotificationShown(): boolean {
    const config: Config = readConfig() || {};
    return config.trayNotificationShown || false;
}

// 设置托盘通知已显示状态
export function setTrayNotificationShown(shown: boolean): void {
    const config: Config = readConfig() || {};
    config.trayNotificationShown = shown;
    writeConfig(config);
}

// 获取MPV播放器路径配置
export function getMpvPlayerPath(): string | undefined {
    const config: Config = readConfig() || {};
    return config.mpvPlayerPath;
}

// 设置MPV播放器路径配置
export function setMpvPlayerPath(path: string | null): void {
    const config: Config = readConfig() || {};
    if (path === null || path === '') {
        delete config.mpvPlayerPath; // 清空配置
    } else {
        config.mpvPlayerPath = path;
    }
    writeConfig(config);
}

export function getMpvVolume(): number {
    const volume = readConfig()?.mpvVolume;
    return typeof volume === 'number' && Number.isFinite(volume)
        ? Math.min(100, Math.max(0, Math.round(volume)))
        : 70;
}

export function setMpvVolume(volume: number): void {
    if (!Number.isFinite(volume)) {
        throw new Error('MPV音量必须是有限数值');
    }

    const config: Config = readConfig() || {};
    config.mpvVolume = Math.min(100, Math.max(0, Math.round(volume)));
    writeConfig(config);
}

// 向后兼容的函数
export function getDownloadProxyUrl(): string {
    return getDownloadProxyConfig().proxyUrl;
}

export function setDownloadProxyUrl(proxyUrl: string): void {
    const current = getDownloadProxyConfig();
    setDownloadProxyConfig({ enabled: current.enabled, proxyUrl });
}

export function getExitMode(): 'direct' | 'minimize' | 'ask' {
    const config = readConfig();
    return config?.exitMode ?? 'ask';
}

export function setExitMode(mode: 'direct' | 'minimize' | 'ask'): void {
    const config = readConfig() ?? {};
    const updatedConfig = {
        ...config,
        exitMode: mode
    };
    writeConfig(updatedConfig);
}

// CommonJS导出，确保与现有代码兼容
module.exports = {
    saveConfig,
    readConfig,
    addHistory,
    getHistory,
    getHistoryCredentials,
    clearHistory,
    deleteHistoryItem,
    getDownloadProxyUrl,
    setDownloadProxyUrl,
    getDownloadProxyConfig,
    setDownloadProxyConfig,
    getHideOriginalPlayButton,
    setHideOriginalPlayButton,
    getNasProxyEnabled,
    setNasProxyEnabled,
    getMacCloseAction,
    setMacCloseAction,
    getTrayNotificationShown,
    setTrayNotificationShown,
    getMpvPlayerPath,
    setMpvPlayerPath,
    getMpvVolume,
    setMpvVolume,
    getExitMode,
    setExitMode
};
