import { isDeepStrictEqual } from 'node:util';
import { platformBehavior } from '../../public/platform';
import type { CloseBehavior, CloseBehaviorSetting } from '../../public/platform/shared';
import * as log from '../logger';
import { type StoredConfig, readConfigFile, usableHistory, writeConfigFile } from './configFile';

export interface AppDownloadProxy {
    enabled: boolean;
    proxyUrl: string;
}

export interface Preferences {
    appDownloadProxy: AppDownloadProxy;
    mpvPlayback: boolean;
    nasLocalProxy: boolean;
    userMpvPath: string | undefined;
    closeBehavior: CloseBehavior;
}

export type PreferenceName = keyof Preferences;

interface Preference<T> {
    read(config: StoredConfig): T;
    write(config: StoredConfig, value: T): void;
}

export const DEFAULT_DOWNLOAD_PROXY_URL = 'https://gh-proxy.com/';

const LEGACY_DEFAULT_DOWNLOAD_PROXY_URL = 'https://ghfast.top';

const STORED_CLOSE_BEHAVIOR = {
    macCloseAction: { hide: 'minimize', quit: 'quit', ask: 'ask' },
    exitMode: { hide: 'minimize', quit: 'direct', ask: 'ask' },
} as const satisfies Record<CloseBehaviorSetting, Record<CloseBehavior, string>>;

const CLOSE_BEHAVIORS: CloseBehavior[] = ['hide', 'quit', 'ask'];

const PREFERENCES: { [K in PreferenceName]: Preference<Preferences[K]> } = {
    appDownloadProxy: {
        read(config) {
            const stored = typeof config.downloadProxy === 'string' ? config.downloadProxy : '';
            const normalized = stored.trim().replace(/\/$/, '');
            const isCustom = normalized !== '' && normalized !== LEGACY_DEFAULT_DOWNLOAD_PROXY_URL;
            return {
                enabled: config.downloadProxyEnabled === true,
                proxyUrl: isCustom ? stored : DEFAULT_DOWNLOAD_PROXY_URL,
            };
        },
        write(config, { enabled, proxyUrl }) {
            config.downloadProxyEnabled = enabled;
            config.downloadProxy = proxyUrl || DEFAULT_DOWNLOAD_PROXY_URL;
        },
    },
    mpvPlayback: {
        read: (config) => config.hideOriginalPlayButton === undefined || config.hideOriginalPlayButton === true,
        write(config, enabled) { config.hideOriginalPlayButton = enabled; },
    },
    nasLocalProxy: {
        read: (config) => config.nasProxyEnabled === true,
        write(config, enabled) { config.nasProxyEnabled = enabled; },
    },
    userMpvPath: {
        read: (config) => (typeof config.mpvPlayerPath === 'string' && config.mpvPlayerPath !== '' ? config.mpvPlayerPath : undefined),
        write(config, mpvPath) {
            if (mpvPath) {
                config.mpvPlayerPath = mpvPath;
            } else {
                delete config.mpvPlayerPath;
            }
        },
    },
    closeBehavior: {
        read(config) {
            const setting = platformBehavior().closeBehaviorSetting;
            const stored = config[setting];
            return CLOSE_BEHAVIORS.find(behavior => STORED_CLOSE_BEHAVIOR[setting][behavior] === stored) ?? 'ask';
        },
        write(config, behavior) {
            const setting = platformBehavior().closeBehaviorSetting;
            config[setting] = STORED_CLOSE_BEHAVIOR[setting][behavior];
        },
    },
};

const listeners = new Set<(name: PreferenceName) => void>();

function readStoredConfig(): StoredConfig {
    const stored = readConfigFile();
    return stored ? { ...stored, history: usableHistory(stored) } : {};
}

export function get<K extends PreferenceName>(name: K): Preferences[K] {
    return PREFERENCES[name].read(readStoredConfig());
}

export function set<K extends PreferenceName>(name: K, value: Preferences[K]): void {
    const preference = PREFERENCES[name];
    const config = readStoredConfig();
    const before = preference.read(config);
    preference.write(config, value);
    writeConfigFile(config);
    if (isDeepStrictEqual(before, preference.read(config))) return;
    for (const listener of listeners) {
        try {
            listener(name);
        } catch (error) {
            log.error(`处理用户偏好 ${name} 的变化失败:`, error);
        }
    }
}

export function onChange(listener: (name: PreferenceName) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

const clampVolume = (volume: number): number => Math.min(100, Math.max(0, Math.round(volume)));

export function mpvVolume(): number {
    const volume = readStoredConfig().mpvVolume;
    return typeof volume === 'number' && Number.isFinite(volume) ? clampVolume(volume) : 70;
}

export function setMpvVolume(volume: number): void {
    if (!Number.isFinite(volume)) {
        throw new Error('MPV音量必须是有限数值');
    }
    const config = readStoredConfig();
    config.mpvVolume = clampVolume(volume);
    writeConfigFile(config);
}

export function trayNotificationShown(): boolean {
    return readStoredConfig().trayNotificationShown === true;
}

export function markTrayNotificationShown(): void {
    const config = readStoredConfig();
    config.trayNotificationShown = true;
    writeConfigFile(config);
}
