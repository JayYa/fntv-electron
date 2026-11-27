import { isDeepStrictEqual } from 'node:util';
import { platformBehavior } from '../../public/platform';
import type { CloseBehavior, CloseBehaviorSetting } from '../../public/platform/shared';
import * as log from '../logger';
import { type ConfigValues, configSection } from './configFile';

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

const STORED_KEYS = [
    'downloadProxyEnabled',
    'downloadProxy',
    'hideOriginalPlayButton',
    'nasProxyEnabled',
    'mpvPlayerPath',
    'macCloseAction',
    'exitMode',
] as const;

const section = configSection(STORED_KEYS);

type StoredPreferences = ConfigValues<typeof STORED_KEYS[number]>;

interface Preference<T> {
    read(config: StoredPreferences): T;
    write(config: StoredPreferences, value: T): void;
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

function readStored(): StoredPreferences {
    return section.read() ?? {};
}

export function get<K extends PreferenceName>(name: K): Preferences[K] {
    return PREFERENCES[name].read(readStored());
}

function writePreference<K extends PreferenceName>(config: StoredPreferences, name: K, value: Preferences[K]): boolean {
    const preference = PREFERENCES[name];
    const before = preference.read(config);
    preference.write(config, value);
    return !isDeepStrictEqual(before, preference.read(config));
}

function notify(name: PreferenceName): void {
    for (const listener of listeners) {
        try {
            listener(name);
        } catch (error) {
            log.error(`处理用户偏好 ${name} 的变化失败:`, error);
        }
    }
}

export function update(patch: Partial<Preferences>): void {
    const names = Object.keys(patch) as PreferenceName[];
    if (names.length === 0) return;
    const config = readStored();
    const changed = names.filter(name => writePreference(config, name, patch[name] as Preferences[typeof name]));
    section.replace(config);
    changed.forEach(notify);
}

export function set<K extends PreferenceName>(name: K, value: Preferences[K]): void {
    update({ [name]: value });
}

export type PreferencesSnapshot = Pick<Preferences, 'appDownloadProxy' | 'mpvPlayback'> & { defaultProxyUrl: string };

export function snapshot(): PreferencesSnapshot {
    const config = readStored();
    return {
        appDownloadProxy: PREFERENCES.appDownloadProxy.read(config),
        mpvPlayback: PREFERENCES.mpvPlayback.read(config),
        defaultProxyUrl: DEFAULT_DOWNLOAD_PROXY_URL,
    };
}

export function onChange(listener: (name: PreferenceName) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

