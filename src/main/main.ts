import { app, BrowserWindow } from 'electron';
import { registerAllPlugins } from './handlers';
import { getInstance as getUpdateChecker } from '../modules/updater/updateChecker';
import { createTray, destroyTray, showTrayBalloon } from './common/tray';
import { mpvRuntime } from './common/mpvRuntime';
import * as log from '../modules/logger';
import { mainWindow } from './common/mainWindow';
import { restoreAtStartup } from './common/currentLogin';
import { isTrusted, showCertificateTrustDialog } from '../modules/cert_trust';
import { startProxyProcess, shutdownProxyProcess } from './common/proxy';
import { platformBehavior } from '../public/platform';
import { initQuitCoordinator } from '../modules/quit/quitCoordinator';

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
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

            mainWindow.start({ showBalloon: showTrayBalloon, downloadProgress: getUpdateChecker().downloadProgress });

            app.on('second-instance', () => mainWindow.show());

            if (platformBehavior().hasDock) {
                app.on('activate', () => mainWindow.show());
            }

            registerAllPlugins();

            mpvRuntime.syncAtStartup();

            await createTray();

            await restoreAtStartup(mainWindow.window());

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
