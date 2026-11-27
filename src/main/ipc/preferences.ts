import * as preferences from '../../modules/fn_config/preferences';
import type { PreferencesPatch, SavePreferencesResult } from '../../public/ipcChannels';
import { type ChannelHandlers, InvalidPayload, noPayload } from './adapter';
import { boolean, isRecord, record } from './parse';

function parsePatch(raw: unknown): PreferencesPatch {
    const patch: PreferencesPatch = {};
    for (const [name, value] of Object.entries(record(raw, '设置'))) {
        if (name === 'appDownloadProxy') {
            if (!isRecord(value)) throw new InvalidPayload('应用更新下载加速不是对象');
            patch.appDownloadProxy = {
                enabled: boolean(value.enabled, '应用更新下载加速的开关'),
                proxyUrl: typeof value.proxyUrl === 'string' ? value.proxyUrl : '',
            };
        } else if (name === 'mpvPlayback') {
            patch.mpvPlayback = boolean(value, 'MPV 接管开关');
        } else {
            throw new InvalidPayload(`不能从登录页修改 ${name}`);
        }
    }
    return patch;
}

function savePreferences(patch: PreferencesPatch): SavePreferencesResult {
    try {
        preferences.update(patch);
        return { success: true, preferences: preferences.snapshot() };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

export const preferencesHandlers: Pick<ChannelHandlers, 'get-preferences' | 'set-preferences'> = {
    'get-preferences': { parse: noPayload, handle: () => preferences.snapshot() },
    'set-preferences': { parse: parsePatch, handle: savePreferences },
};
