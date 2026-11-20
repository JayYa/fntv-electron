import { isMpvPlaybackEnabled } from './playbackPreference';
import { type StoredConfig, readConfigFile, usableHistory, writeConfigFile } from './configFile';

// 普通设置项，和登录存储在同一个 config.json 里。读写不经过 safeStorage：凭据保持磁盘值，原样写回。

interface Settings extends StoredConfig {
    downloadProxyEnabled?: unknown;
    downloadProxy?: unknown;
    hideOriginalPlayButton?: unknown;
    macCloseAction?: 'minimize' | 'quit' | 'ask';
    trayNotificationShown?: boolean;
    nasProxyEnabled?: unknown;
    mpvPlayerPath?: string;
    mpvVolume?: unknown;
    exitMode?: 'direct' | 'minimize' | 'ask';
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

/**
 * 文件不存在或内容损坏时返回空配置，写入时会先备份损坏的文件。
 * 登录历史里不能用的条目读取时跳过，写回时一起去掉。
 */
function readStoredConfig(): Settings {
    const stored = readConfigFile();
    return stored ? { ...stored, history: usableHistory(stored) } : {};
}

const writeStoredConfig = writeConfigFile;

/** 应用更新下载加速的默认中转地址，主进程和登录页都从这里取 */
export const DEFAULT_DOWNLOAD_PROXY_URL = 'https://gh-proxy.com/';

// 旧版默认中转地址。旧版设置面板保存时会把它写进配置，读到它就当作没自定义
const LEGACY_DEFAULT_DOWNLOAD_PROXY_URL = 'https://ghfast.top';

// 获取应用更新下载加速配置。没存过、存的是空白或旧版默认地址时返回默认地址，配置文件不改
export function getAppDownloadProxyConfig(): AppDownloadProxyConfig {
    const config = readStoredConfig();
    const stored = typeof config.downloadProxy === 'string' ? config.downloadProxy : '';
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

export function getExitMode(): 'direct' | 'minimize' | 'ask' {
    return readStoredConfig().exitMode ?? 'ask';
}

export function setExitMode(mode: 'direct' | 'minimize' | 'ask'): void {
    const config = readStoredConfig();
    config.exitMode = mode;
    writeStoredConfig(config);
}
