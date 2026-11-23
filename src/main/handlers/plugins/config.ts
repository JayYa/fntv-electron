import { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import * as settings from '../../../modules/fn_config/settings';
import { isMpvPlaybackEnabled } from '../../../modules/fn_config/playbackPreference';
import { registerHandler } from '../core/ipcHandler';

interface ProxyConfig {
    enabled: boolean;
    proxyUrl: string;
}

interface PlayButtonConfig {
    hideOriginalPlayButton: boolean;
}

type SaveResult = { success: true } | { success: false; error: string };

function handleGetAppDownloadProxy(event: IpcMainEvent): void {
    const proxyConfig = settings.getAppDownloadProxyConfig();
    event.reply('download-proxy-info', { ...proxyConfig, defaultProxyUrl: settings.DEFAULT_DOWNLOAD_PROXY_URL });
}

function handleSetAppDownloadProxy(_event: IpcMainInvokeEvent, { enabled, proxyUrl }: Partial<ProxyConfig> = {}): SaveResult {
    try {
        settings.setAppDownloadProxyConfig({
            enabled: enabled === true,
            proxyUrl: proxyUrl || settings.DEFAULT_DOWNLOAD_PROXY_URL
        });
        return { success: true };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

function handleGetPlayButtonConfig(event: IpcMainEvent): void {
    event.reply('play-button-config-info', {
        hideOriginalPlayButton: settings.getHideOriginalPlayButton(),
    });
}

function handleSetPlayButtonConfig(_event: IpcMainInvokeEvent, config?: Partial<PlayButtonConfig>): SaveResult {
    try {
        settings.setHideOriginalPlayButton(isMpvPlaybackEnabled(config?.hideOriginalPlayButton));
        return { success: true };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

function handleGetNasProxyConfig(event: IpcMainEvent): void {
    const nasProxyEnabled = settings.getNasProxyEnabled();
    event.reply('nas-proxy-info', { nasProxyEnabled });
}

function handleSetNasProxyConfig(event: IpcMainEvent, { nasProxyEnabled }: { nasProxyEnabled: boolean }): void {
    try {
        settings.setNasProxyEnabled(nasProxyEnabled !== false);
        event.reply('nas-proxy-set', { success: true });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        event.reply('nas-proxy-set', { success: false, error: errorMessage });
    }
}

function init(): void {
    registerHandler('get-download-proxy', handleGetAppDownloadProxy);
    registerHandler('set-download-proxy', handleSetAppDownloadProxy, { useHandle: true });
    registerHandler('get-play-button-config', handleGetPlayButtonConfig);
    registerHandler('set-play-button-config', handleSetPlayButtonConfig, { useHandle: true });
    registerHandler('get-nas-proxy', handleGetNasProxyConfig);
    registerHandler('set-nas-proxy', handleSetNasProxyConfig);
}

export {
    init
};
