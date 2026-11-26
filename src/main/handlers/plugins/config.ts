import { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import * as preferences from '../../../modules/fn_config/preferences';
import { registerHandler } from '../core/ipcHandler';

type SaveResult = { success: true; preferences: preferences.PreferencesSnapshot } | { success: false; error: string };

type Patch = Partial<Pick<preferences.Preferences, 'appDownloadProxy' | 'mpvPlayback'>>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function parsePatch(request: unknown): Patch | string {
    if (!isRecord(request)) return '设置不是对象';
    const patch: Patch = {};
    for (const [name, value] of Object.entries(request)) {
        if (name === 'appDownloadProxy') {
            if (!isRecord(value) || typeof value.enabled !== 'boolean') return '应用更新下载加速的开关不是布尔值';
            patch.appDownloadProxy = { enabled: value.enabled, proxyUrl: typeof value.proxyUrl === 'string' ? value.proxyUrl : '' };
        } else if (name === 'mpvPlayback') {
            if (typeof value !== 'boolean') return 'MPV 接管开关不是布尔值';
            patch.mpvPlayback = value;
        } else {
            return `不能从登录页修改 ${name}`;
        }
    }
    return patch;
}

function handleGetPreferences(event: IpcMainEvent): void {
    event.reply('preferences-snapshot', preferences.snapshot());
}

function handleSetPreferences(_event: IpcMainInvokeEvent, request?: unknown): SaveResult {
    const patch = parsePatch(request);
    if (typeof patch === 'string') return { success: false, error: patch };
    try {
        preferences.update(patch);
        return { success: true, preferences: preferences.snapshot() };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

function init(): void {
    registerHandler('get-preferences', handleGetPreferences);
    registerHandler('set-preferences', handleSetPreferences, { useHandle: true });
}

export {
    init
};
