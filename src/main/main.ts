import { app, dialog } from 'electron';
import { startIpc } from './ipc';
import { getInstance as getUpdateChecker } from '../modules/updater/updateChecker';
import { createTray, destroyTray, showTrayBalloon } from './common/tray';
import { mpvRuntime } from './common/mpvRuntime';
import * as log from '../modules/logger';
import { mainWindow } from './common/mainWindow';
import { endCurrentLogin, restoreAtStartup } from './common/currentLogin';
import * as webUiSession from './common/webUiSession';
import * as certTrust from '../modules/cert_trust';
import { proxy } from './common/proxy';
import { removeLegacyProxySecret } from './common/legacyProxySecret';
import { platformBehavior } from '../public/platform';
import { initQuitCoordinator } from '../modules/quit/quitCoordinator';

const gotTheLock = app.requestSingleInstanceLock();

async function showErrorAndQuit(title: string, message: string): Promise<void> {
    try {
        await dialog.showMessageBox({ type: 'error', title, message, buttons: ['退出应用'] });
    } finally {
        app.quit();
    }
}

async function startProxy(): Promise<void> {
    removeLegacyProxySecret(app.getPath('userData'), log);
    try {
        await proxy.start({
            onUnrecoverable: () => {
                void showErrorAndQuit('应用即将退出', '飞牛影视的播放服务（Proxy）多次启动失败，无法继续运行。');
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('启动 Proxy 失败:', message);
        await showErrorAndQuit('启动失败', `飞牛影视的播放服务（Proxy）无法启动。\n\n错误详情: ${message}\n\n请查看应用日志获取更多信息。`);
        throw error;
    }
}

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

            certTrust.start({ fallbackWindow: () => mainWindow.window() });

            webUiSession.acceptConfirmedCertificates();

            await startProxy();

            mainWindow.start({ showBalloon: showTrayBalloon, downloadProgress: getUpdateChecker().downloadProgress });

            app.on('second-instance', () => mainWindow.show());

            if (platformBehavior().hasDock) {
                app.on('activate', () => mainWindow.show());
            }

            startIpc({ isMainWindow: (sender) => sender === mainWindow.window().webContents });
            webUiSession.start(() => endCurrentLogin(mainWindow.window()));

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
    closeProxy: () => proxy.shutdown(),
    onQuitReleased: destroyTray,
});

app.on('window-all-closed', () => {
    if (platformBehavior().quitsWhenAllWindowsClosed) {
        app.quit();
    }
});
