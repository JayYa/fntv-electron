import { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import * as preferences from '../../../modules/fn_config/preferences';
import { registerHandler } from '../core/ipcHandler';

type SaveResult = { success: true } | { success: false; error: string };

function save(write: () => void): SaveResult {
    try {
        write();
        return { success: true };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

function handleGetAppDownloadProxy(event: IpcMainEvent): void {
    event.reply('download-proxy-info', { ...preferences.get('appDownloadProxy'), defaultProxyUrl: preferences.DEFAULT_DOWNLOAD_PROXY_URL });
}

function handleSetAppDownloadProxy(_event: IpcMainInvokeEvent, request?: { enabled?: unknown; proxyUrl?: unknown }): SaveResult {
    const { enabled, proxyUrl } = request ?? {};
    if (typeof enabled !== 'boolean') return { success: false, error: '应用更新下载加速的开关不是布尔值' };
    return save(() => preferences.set('appDownloadProxy', { enabled, proxyUrl: typeof proxyUrl === 'string' ? proxyUrl : '' }));
}

function handleGetMpvPlayback(event: IpcMainEvent): void {
    event.reply('mpv-playback-info', { mpvPlayback: preferences.get('mpvPlayback') });
}

function handleSetMpvPlayback(_event: IpcMainInvokeEvent, request?: { mpvPlayback?: unknown }): SaveResult {
    const mpvPlayback = request?.mpvPlayback;
    if (typeof mpvPlayback !== 'boolean') return { success: false, error: 'MPV 接管开关不是布尔值' };
    return save(() => preferences.set('mpvPlayback', mpvPlayback));
}

function init(): void {
    registerHandler('get-download-proxy', handleGetAppDownloadProxy);
    registerHandler('set-download-proxy', handleSetAppDownloadProxy, { useHandle: true });
    registerHandler('get-mpv-playback', handleGetMpvPlayback);
    registerHandler('set-mpv-playback', handleSetMpvPlayback, { useHandle: true });
}

export {
    init
};
