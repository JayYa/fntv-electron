import { app, BrowserWindow } from 'electron';
import { registerAllPlugins } from './handlers';
import { getInstance as getUpdateChecker } from '../modules/updater/updateChecker';
import * as winctrl from './common/winctrl';
import { createTray, destroyTray } from './common/tray';
import { bindTaskbarProgress } from './common/taskbarProgress';
import { manageMainWindow, showMainWindow } from './common/closeBehavior';
import * as log from '../modules/logger';
import { getMainWindow } from './common/mainwin';
import { isTrusted, showCertificateTrustDialog } from '../modules/cert_trust';
import { startProxyProcess, shutdownProxyProcess } from './common/proxy';
import { platformBehavior } from '../public/platform';
import { initQuitCoordinator, listenForSystemShutdown } from '../modules/quit/quitCoordinator';

// 禁用输入法自动切换
app.commandLine.appendSwitch('--lang', 'en-US');
app.commandLine.appendSwitch('--disable-features', 'VizDisplayCompositor');

let mainWindow: BrowserWindow | null = null;

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    // 如果没有获取到锁，说明应用已经在运行，直接退出
    app.quit();
} else {
    // 当尝试启动第二个实例时，聚焦到现有窗口
    app.on('second-instance', showMainWindow);

    app.whenReady().then(async () => {
        try {
            // 初始化日志系统
            log.info('=== 飞牛影视启动 ===');
            log.info('应用版本:', app.getVersion());
            log.info('Electron版本:', process.versions.electron);
            log.info('Node.js版本:', process.versions.node);
            log.info('日志文件位置:', log.getLogFile());

            // 动态处理证书验证错误
            app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
                // 检查URL是否在信任列表中
                if (isTrusted(url)) {
                    // log.debug(`URL ${url} 在信任列表中，忽略证书验证错误: ${error}`);
                    event.preventDefault();
                    callback(true); // 信任证书
                } else {
                    log.warn(`证书验证错误: ${url}, 错误: ${error}`);
                    // 对渲染窗口显式询问，避免 FN Connect 跳转到自签名 NAS 后静默白屏。
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

            // 启动 Proxy 子进程，失败时已弹窗说明并退出
            await startProxyProcess();

            // 创建主窗口
            mainWindow = getMainWindow();

            // 系统关机、重启或注销时放弃「退出时安装」（src/modules/quit/quitCoordinator.ts）
            listenForSystemShutdown(mainWindow);

            // 注册所有插件
            registerAllPlugins();

            // 创建系统托盘
            await createTray(mainWindow);

            manageMainWindow(mainWindow);

            // 设置全屏切换
            winctrl.setupFullScreenToggle(mainWindow);

            // 禁用输入法自动切换
            winctrl.setupInputMethodDisable(mainWindow);

            // 设置窗口显示事件
            winctrl.setupWindowShowEvents(mainWindow);

            // 恢复 Cookie
            await winctrl.setupCookieRestore(mainWindow);

            // 应用内更新下载中，主窗口的任务栏图标显示进度条，下载结束时去掉
            bindTaskbarProgress(mainWindow, getUpdateChecker().downloadProgress);

            // 延迟3秒后检查更新，避免影响应用启动速度
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

// 退出收尾：先停播放、等进度回传，再关 Proxy，最后才销毁托盘（src/modules/quit/quitCoordinator.ts）
initQuitCoordinator({
    closeProxy: shutdownProxyProcess,
    onQuitReleased: destroyTray,
});

// 唯一的 window-all-closed 监听（#76）。不在退出途中时，主窗口的 close 被拦下改为隐藏，这个事件很少发生；
// app.quit() 关掉所有窗口时 Electron 直接退出，不发这个事件（Electron shell/browser/browser.cc 的 Browser::OnWindowAllClosed）。
app.on('window-all-closed', () => {
    // 在 macOS 上，除非明确退出，否则应用程序及其菜单栏通常会保持活动状态
    if (platformBehavior().quitsWhenAllWindowsClosed) {
        app.quit();
    }
});

app.on('activate', () => {
    // 在 macOS 上，当点击 dock 图标且没有其他窗口打开时，
    // 通常会重新创建一个窗口
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
