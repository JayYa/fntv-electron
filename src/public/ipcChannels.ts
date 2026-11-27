import type { LoginReply } from '../main/common/currentLogin';
import type { HistoryKey, HistoryListing } from '../modules/fn_config/loginStore';
import type { Preferences, PreferencesSnapshot } from '../modules/fn_config/preferences';
import type { PlayRequest } from '../modules/playback/playRequest';
import type { PlatformBehavior } from './platform/shared';

export type Caller = 'loginPage' | 'webUi' | 'both';

export const REQUEST_CALLERS = {
    'login': 'loginPage',
    'get-config': 'loginPage',
    'get-history-credentials': 'loginPage',
    'get-current-access-code': 'loginPage',
    'delete-history-item': 'loginPage',
    'clear-history': 'loginPage',
    'set-preferences': 'loginPage',
    'open-external': 'loginPage',
    'check-update': 'loginPage',
    'get-version': 'loginPage',
    'play-movie': 'webUi',
    'get-preferences': 'both',
    'window-minimize': 'both',
    'window-maximize': 'both',
    'window-close': 'both',
    'get-title-bar': 'both',
    'log-message': 'both',
    'preload-started': 'both',
} as const satisfies Record<string, Caller>;

export type RequestChannel = keyof typeof REQUEST_CALLERS;

export const PUSH_CHANNELS = ['preferences-snapshot'] as const;

export type PushChannel = (typeof PUSH_CHANNELS)[number];

export interface LoginRequest {
    domain: string;
    username: string;
    password: string;
    accessCode?: string;
    useHttps?: boolean;
}

export interface LoginPageConfig {
    config: { account?: string; domain?: string; hasAccessCode: boolean; useHttps?: boolean };
    history: HistoryListing[];
}

export type PreferencesPatch = Partial<Pick<Preferences, 'appDownloadProxy' | 'mpvPlayback'>>;

export type SavePreferencesResult = { success: true; preferences: PreferencesSnapshot } | { success: false; error: string };

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Requests {
    'login': { payload: LoginRequest; result: LoginReply };
    'get-config': { payload: undefined; result: LoginPageConfig };
    'get-history-credentials': { payload: HistoryKey; result: { password: string; accessCode: string } };
    'get-current-access-code': { payload: undefined; result: { domain?: string; account?: string; accessCode: string } };
    'delete-history-item': { payload: HistoryKey; result: boolean };
    'clear-history': { payload: undefined; result: void };
    'set-preferences': { payload: PreferencesPatch; result: SavePreferencesResult };
    'open-external': { payload: string; result: void };
    'check-update': { payload: undefined; result: void };
    'get-version': { payload: undefined; result: { version: string; name: string } };
    'play-movie': { payload: PlayRequest; result: void };
    'get-preferences': { payload: undefined; result: PreferencesSnapshot };
    'window-minimize': { payload: undefined; result: void };
    'window-maximize': { payload: undefined; result: void };
    'window-close': { payload: undefined; result: void };
    'get-title-bar': { payload: undefined; result: PlatformBehavior['titleBar'] };
    'log-message': { payload: { level: LogLevel; args: unknown[] }; result: void };
    'preload-started': { payload: string[]; result: void };
}

export interface Pushes {
    'preferences-snapshot': PreferencesSnapshot;
}

export type Payload<C extends RequestChannel> = Requests[C]['payload'];

export type Result<C extends RequestChannel> = Requests[C]['result'];

export function isRequestChannel(channel: unknown): channel is RequestChannel {
    return typeof channel === 'string' && Object.hasOwn(REQUEST_CALLERS, channel);
}

export function mayCall(channel: unknown, caller: Exclude<Caller, 'both'>): boolean {
    if (!isRequestChannel(channel)) return false;
    const allowed: Caller = REQUEST_CALLERS[channel];
    return allowed === 'both' || allowed === caller;
}

export function isPushChannel(channel: unknown): channel is PushChannel {
    return (PUSH_CHANNELS as readonly unknown[]).includes(channel);
}
