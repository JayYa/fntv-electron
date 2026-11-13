import { IpcMainEvent } from 'electron';
import * as fnConfig from '../../../modules/fn_config/config';
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

// 获取应用更新下载加速设置，带上默认地址给登录页做 placeholder
function handleGetAppDownloadProxy(event: IpcMainEvent): void {
    const proxyConfig = fnConfig.getAppDownloadProxyConfig();
    event.reply('download-proxy-info', { ...proxyConfig, defaultProxyUrl: fnConfig.DEFAULT_DOWNLOAD_PROXY_URL });
}

// 设置应用更新下载加速，地址为空时用默认地址
function handleSetAppDownloadProxy(event: IpcMainEvent, { enabled, proxyUrl }: Partial<ProxyConfig>): void {
    try {
        fnConfig.setAppDownloadProxyConfig({
            enabled: enabled === true,
            proxyUrl: proxyUrl || fnConfig.DEFAULT_DOWNLOAD_PROXY_URL
        });
        event.reply('download-proxy-set', { success: true });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        event.reply('download-proxy-set', { success: false, error: errorMessage });
    }
}

// 获取播放按钮配置
function handleGetPlayButtonConfig(event: IpcMainEvent): void {
    event.reply('play-button-config-info', {
        hideOriginalPlayButton: fnConfig.getHideOriginalPlayButton(),
    });
}

// 设置播放按钮配置
function handleSetPlayButtonConfig(event: IpcMainEvent, config?: Partial<PlayButtonConfig>): void {
    try {
        fnConfig.setHideOriginalPlayButton(isMpvPlaybackEnabled(config?.hideOriginalPlayButton));
        event.reply('play-button-config-set', { success: true });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        event.reply('play-button-config-set', { success: false, error: errorMessage });
    }
}

// 获取NAS代理配置
function handleGetNasProxyConfig(event: IpcMainEvent): void {
    const nasProxyEnabled = fnConfig.getNasProxyEnabled();
    event.reply('nas-proxy-info', { nasProxyEnabled });
}

// 设置NAS代理配置
function handleSetNasProxyConfig(event: IpcMainEvent, { nasProxyEnabled }: { nasProxyEnabled: boolean }): void {
    try {
        fnConfig.setNasProxyEnabled(nasProxyEnabled !== false);
        event.reply('nas-proxy-set', { success: true });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        event.reply('nas-proxy-set', { success: false, error: errorMessage });
    }
}

// 注册配置相关处理器
function init(): void {
    registerHandler('get-download-proxy', handleGetAppDownloadProxy);
    registerHandler('set-download-proxy', handleSetAppDownloadProxy);
    registerHandler('get-play-button-config', handleGetPlayButtonConfig);
    registerHandler('set-play-button-config', handleSetPlayButtonConfig);
    registerHandler('get-nas-proxy', handleGetNasProxyConfig);
    registerHandler('set-nas-proxy', handleSetNasProxyConfig);
}

export {
    init
};
