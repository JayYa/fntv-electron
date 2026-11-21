import { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import * as settings from '../../../modules/fn_config/settings';
import { isMpvPlaybackEnabled } from '../../../modules/fn_config/playbackPreference';
import { registerHandler } from '../core/ipcHandler';

/**
 * 系统配置插件
 * 处理下载代理等系统配置功能
 */

interface ProxyConfig {
    enabled: boolean;
    proxyUrl: string;
}

interface PlayButtonConfig {
    hideOriginalPlayButton: boolean;
}

type SaveResult = { success: true } | { success: false; error: string };

// 获取应用更新下载加速设置，带上默认地址给登录页做 placeholder
function handleGetAppDownloadProxy(event: IpcMainEvent): void {
    const proxyConfig = settings.getAppDownloadProxyConfig();
    event.reply('download-proxy-info', { ...proxyConfig, defaultProxyUrl: settings.DEFAULT_DOWNLOAD_PROXY_URL });
}

// 设置应用更新下载加速，地址为空时用默认地址
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

// 获取播放按钮配置
function handleGetPlayButtonConfig(event: IpcMainEvent): void {
    event.reply('play-button-config-info', {
        hideOriginalPlayButton: settings.getHideOriginalPlayButton(),
    });
}

// 设置播放按钮配置
function handleSetPlayButtonConfig(_event: IpcMainInvokeEvent, config?: Partial<PlayButtonConfig>): SaveResult {
    try {
        settings.setHideOriginalPlayButton(isMpvPlaybackEnabled(config?.hideOriginalPlayButton));
        return { success: true };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

// 获取NAS代理配置
function handleGetNasProxyConfig(event: IpcMainEvent): void {
    const nasProxyEnabled = settings.getNasProxyEnabled();
    event.reply('nas-proxy-info', { nasProxyEnabled });
}

// 设置NAS代理配置
function handleSetNasProxyConfig(event: IpcMainEvent, { nasProxyEnabled }: { nasProxyEnabled: boolean }): void {
    try {
        settings.setNasProxyEnabled(nasProxyEnabled !== false);
        event.reply('nas-proxy-set', { success: true });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        event.reply('nas-proxy-set', { success: false, error: errorMessage });
    }
}

// 注册配置相关处理器
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
