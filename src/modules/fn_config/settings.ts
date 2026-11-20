import { isMpvPlaybackEnabled } from './playbackPreference';
import { type StoredConfig, readConfigFile, usableHistory, writeConfigFile } from './configFile';

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

export interface AppDownloadProxyConfig {
    enabled: boolean;
    proxyUrl: string;
}

export interface SetAppDownloadProxyConfigParams {
    enabled?: boolean;
    proxyUrl?: string;
}

function readStoredConfig(): Settings {
    const stored = readConfigFile();
    return stored ? { ...stored, history: usableHistory(stored) } : {};
}


export const DEFAULT_DOWNLOAD_PROXY_URL = 'https://gh-proxy.com/';

const LEGACY_DEFAULT_DOWNLOAD_PROXY_URL = 'https://ghfast.top';

export function getAppDownloadProxyConfig(): AppDownloadProxyConfig {
    const config = readStoredConfig();
    const stored = typeof config.downloadProxy === 'string' ? config.downloadProxy : '';
    const normalized = stored.trim().replace(/\/$/, '');
    const isCustom = normalized !== '' && normalized !== LEGACY_DEFAULT_DOWNLOAD_PROXY_URL;
    return {
        enabled: config.downloadProxyEnabled === true,
        proxyUrl: isCustom ? stored : DEFAULT_DOWNLOAD_PROXY_URL
    };
}

export function setAppDownloadProxyConfig({ enabled = false, proxyUrl = DEFAULT_DOWNLOAD_PROXY_URL }: SetAppDownloadProxyConfigParams = {}): void {
    const config = readStoredConfig();
    config.downloadProxyEnabled = enabled;
    config.downloadProxy = proxyUrl;
    writeConfigFile(config);
}

export function getHideOriginalPlayButton(): boolean {
    const config = readStoredConfig();
    return isMpvPlaybackEnabled(config.hideOriginalPlayButton);
}

export function setHideOriginalPlayButton(enabled: boolean): void {
    const config = readStoredConfig();
    config.hideOriginalPlayButton = enabled;
    writeConfigFile(config);
}

export function getNasProxyEnabled(): boolean {
    const config = readStoredConfig();
    return config.nasProxyEnabled === true;
}

export function setNasProxyEnabled(enabled: boolean): void {
    const config = readStoredConfig();
    config.nasProxyEnabled = enabled;
    writeConfigFile(config);
}

export function getMacCloseAction(): 'minimize' | 'quit' | 'ask' {
    const config = readStoredConfig();
    return config.macCloseAction || 'ask';
}

export function setMacCloseAction(action: 'minimize' | 'quit' | 'ask'): void {
    const config = readStoredConfig();
    config.macCloseAction = action;
    writeConfigFile(config);
}

export function getTrayNotificationShown(): boolean {
    const config = readStoredConfig();
    return config.trayNotificationShown || false;
}

export function setTrayNotificationShown(shown: boolean): void {
    const config = readStoredConfig();
    config.trayNotificationShown = shown;
    writeConfigFile(config);
}

export function getMpvPlayerPath(): string | undefined {
    const config = readStoredConfig();
    return config.mpvPlayerPath;
}

export function setMpvPlayerPath(path: string | null): void {
    const config = readStoredConfig();
    if (path === null || path === '') {
        delete config.mpvPlayerPath;
    } else {
        config.mpvPlayerPath = path;
    }
    writeConfigFile(config);
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
    writeConfigFile(config);
}

export function getExitMode(): 'direct' | 'minimize' | 'ask' {
    return readStoredConfig().exitMode ?? 'ask';
}

export function setExitMode(mode: 'direct' | 'minimize' | 'ask'): void {
    const config = readStoredConfig();
    config.exitMode = mode;
    writeConfigFile(config);
}
