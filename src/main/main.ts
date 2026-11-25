import { app, BrowserWindow } from 'electron';
import { registerAllPlugins } from './handlers';
import { getInstance as getUpdateChecker } from '../modules/updater/updateChecker';
import * as winctrl from './common/winctrl';
import { createTray, destroyTray } from './common/tray';
import { mpvRuntime } from './common/mpvRuntime';
import { bindTaskbarProgress } from './common/taskbarProgress';
import { manageMainWindow, showMainWindow } from './common/closeBehavior';
import * as log from '../modules/logger';
import { getMainWindow } from './common/mainwin';
import { reloadWebUiOnMpvPlaybackChange, restoreAtStartup } from './common/currentLogin';
import { isTrusted, showCertificateTrustDialog } from '../modules/cert_trust';
import { startProxyProcess, shutdownProxyProcess } from './common/proxy';
import { platformBehavior } from '../public/platform';
import { initQuitCoordinator, listenForSystemShutdown } from '../modules/quit/quitCoordinator';

let mainWindow: BrowserWindow | null = null;

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', showMainWindow);

    app.whenReady().then(async () => {
        try {
            log.info('=== 飞牛影视启动 ===');
            log.info('应用版本:', app.getVersion());
            log.info('Electron版本:', process.versions.electron);
            log.info('Node.js版本:', process.versions.node);
            log.info('日志文件位置:', log.getLogFile());

            app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
                if (isTrusted(url)) {
                    event.preventDefault();
                    callback(true);
                } else {
                    log.warn(`证书验证错误: ${url}, 错误: ${error}`);
                    event.preventDefault();
                    const parentWindow = BrowserWindow.fromWebContents(webContents) || undefined;
                    showCertificateTrustDialog(url, error, parentWindow)
                        .then(callback)
                        .catch((dialogError: unknown) => {
                            log.error('处理证书信任确认失败:', dialogError);
                            callback(false);
                        });
                }
            });

            await startProxyProcess();

            mainWindow = getMainWindow();

            listenForSystemShutdown(mainWindow);

            registerAllPlugins();

            mpvRuntime.syncAtStartup();

            await createTray(mainWindow);

            manageMainWindow(mainWindow);

            winctrl.setupFullScreenToggle(mainWindow);

            winctrl.setupWindowShowEvents(mainWindow);

            reloadWebUiOnMpvPlaybackChange(() => mainWindow);

            await restoreAtStartup(mainWindow);

            bindTaskbarProgress(mainWindow, getUpdateChecker().downloadProgress);

            setTimeout(() => {
                getUpdateChecker().autoCheckForUpdates().catch((error: Error) => {
                    log.error('启动时自动检查更新失败:', error);
                });
            }, 3000);
        } catch (error) {
            log.error('应用启动失败:', error);
            app.quit();
        }
    });
}

initQuitCoordinator({
    closeProxy: shutdownProxyProcess,
    onQuitReleased: destroyTray,
});

app.on('window-all-closed', () => {
    if (platformBehavior().quitsWhenAllWindowsClosed) {
        app.quit();
    }
});

app.on('activate', () => {
    if (platformBehavior().hasDock) {
        if (BrowserWindow.getAllWindows().length === 0) {
            mainWindow = getMainWindow();
            manageMainWindow(mainWindow);
            app.dock?.show();
        } else {
            showMainWindow();
        }
    }
});
