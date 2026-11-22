import { Tray, Menu, nativeImage, BrowserWindow, app, dialog, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getCurrentMpvPlayer, getMpvConfigDir } from '../handlers/plugins/mpvConfig';
import { mpvCapabilityTrayItems } from './mpvConfigNotices';
import { countPendingUpdates, stopWatchingPendingUpdates, watchPendingUpdates } from './mpvConfigSync/pendingUpdates';
import { getInstance as getUpdateChecker } from '../../modules/updater/updateChecker';
import { closeBehaviorMenuItem, provideTrayBalloon, showMainWindow } from './closeBehavior';
import * as log from '../../modules/logger';
import * as settings from '../../modules/fn_config/settings';
import { platformBehavior } from '../../public/platform';

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;

async function openMpvConfigDir(mainWindow: BrowserWindow | null, dir: string): Promise<void> {
    if (!fs.existsSync(dir)) {
        const options: Electron.MessageBoxOptions = {
            type: 'info',
            title: 'MPV 用户配置目录',
            message: 'MPV 用户配置目录尚不存在',
            detail: `${dir}\n\n客户端启动时会把默认配置同步到这里。`,
        };
        await (mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options));
        return;
    }
    const error = await shell.openPath(dir);
    if (error) {
        log.error(`打开 MPV 用户配置目录失败: ${error}`, dir);
        dialog.showErrorBox('打开 MPV 用户配置目录失败', `${error}\n\n${dir}`);
    }
}

function pendingMpvUpdatesItems(mainWindow: BrowserWindow | null, mpvConfigDir: string | undefined): Electron.MenuItemConstructorOptions[] {
    watchPendingUpdates(mpvConfigDir, () => {
        updateTrayMenu().catch(error => log.error('刷新托盘菜单失败:', error));
    });
    const pending = mpvConfigDir ? countPendingUpdates(mpvConfigDir) : 0;
    if (!mpvConfigDir || pending === 0) return [];
    return [{
        label: `MPV 配置有 ${pending} 个待合并的更新`,
        click: () => openMpvConfigDir(mainWindow, mpvConfigDir),
    }];
}

async function createSettingsSubmenu(mainWindow: BrowserWindow | null): Promise<Electron.MenuItemConstructorOptions[]> {
    const proxyConfig = settings.getAppDownloadProxyConfig();
    const mpvEnabled = settings.getHideOriginalPlayButton();
    const nasProxyEnabled = settings.getNasProxyEnabled();
    const currentMpvPath = settings.getMpvPlayerPath();
    const playerPath = getCurrentMpvPlayer()?.path;
    let mpvConfigDir: string | undefined;
    try {
        mpvConfigDir = getMpvConfigDir(currentMpvPath);
    } catch (error) {
        log.error('获取 MPV 用户配置目录失败', error);
    }

    const submenu: Electron.MenuItemConstructorOptions[] = [
        {
            label: `应用更新下载加速: ${proxyConfig.enabled ? '开启' : '关闭'}`,
            type: 'checkbox',
            checked: proxyConfig.enabled,
            click: () => {
                const newEnabled = !proxyConfig.enabled;
                settings.setAppDownloadProxyConfig({ enabled: newEnabled, proxyUrl: proxyConfig.proxyUrl });
                updateTrayMenu();
            }
        },
        {
            type: 'separator'
        },
        {
            label: `使用 MPV 播放`,
            type: 'checkbox',
            checked: mpvEnabled,
            click: () => {
                settings.setHideOriginalPlayButton(!mpvEnabled);
                updateTrayMenu();
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.reloadIgnoringCache();
                }
            }
        },
        {
            type: 'separator'
        },
        {
            label: `NAS 中转 网盘/STRM: ${nasProxyEnabled ? '开启' : '关闭'}`,
            type: 'checkbox',
            checked: nasProxyEnabled,
            click: () => {
                const newEnabled = !nasProxyEnabled;
                settings.setNasProxyEnabled(newEnabled);
                updateTrayMenu();
            }
        },
        {
            type: 'separator'
        },
        {
            label: `设置 MPV 播放器路径 (${playerPath ?? '未找到'})`,
            click: async () => {
                if (mainWindow) {
                    const result = await dialog.showOpenDialog(mainWindow, {
                        title: '选择 MPV 播放器',
                        defaultPath: currentMpvPath ? path.dirname(currentMpvPath) : undefined,
                        properties: ['openFile'],
                        filters: [
                            { name: '可执行文件', extensions: platformBehavior().mpvExecutableExtensions },
                            { name: '所有文件', extensions: ['*'] }
                        ]
                    });

                    if (!result.canceled && result.filePaths.length > 0) {
                        const selectedPath = result.filePaths[0];
                        settings.setMpvPlayerPath(selectedPath);
                        log.info(`MPV 播放器路径已设置为: ${selectedPath}`);

                        updateTrayMenu();
                    }
                }
            }
        },
        {
            label: '清空 MPV 播放器路径',
            enabled: !!currentMpvPath,
            click: () => {
                settings.setMpvPlayerPath('');
                log.info('MPV 播放器路径已清空，将使用自动检测');

                updateTrayMenu();
            }
        },
        {
            label: `打开 MPV 用户配置目录 (${mpvConfigDir ?? '无法确定'})`,
            enabled: mpvConfigDir !== undefined,
            click: () => (mpvConfigDir ? openMpvConfigDir(mainWindow, mpvConfigDir) : undefined),
        },
        ...pendingMpvUpdatesItems(mainWindow, mpvConfigDir),
        ...mpvCapabilityTrayItems(),
    ];

    return submenu;
}

function checkForUpdatesLabel(downloadPercent: number | null): string {
    return downloadPercent === null ? '检查更新' : `检查更新（正在下载新版本 ${downloadPercent}%）`;
}

async function updateTrayMenu(): Promise<void> {
    if (!tray) return;
    const behavior = platformBehavior();

    const menuTemplate: Electron.MenuItemConstructorOptions[] = [
        {
            label: '设置',
            submenu: await createSettingsSubmenu(mainWindow)
        },
        {
            type: 'separator'
        },
        {
            label: behavior.tray.showWindowLabel,
            click: showMainWindow,
        },
        {
            type: 'separator'
        },
        {
            label: checkForUpdatesLabel(getUpdateChecker().downloadProgress.percent()),
            click: () => {
                getUpdateChecker().manualCheckForUpdates().catch(error => {
                    log.error('手动检查更新失败:', error);
                });
            }
        },
        {
            type: 'separator'
        },
        closeBehaviorMenuItem(),
        {
            type: 'separator'
        },
        {
            label: behavior.tray.quitLabel,
            click: () => app.quit(),
        }
    ];

    const contextMenu = Menu.buildFromTemplate(menuTemplate);

    tray.setContextMenu(contextMenu);
}

export async function createTray(mainWindowInstance: BrowserWindow): Promise<void> {
    mainWindow = mainWindowInstance;

    const behavior = platformBehavior();
    const buildDir = path.join(__dirname, '../../../build');
    let icon = nativeImage.createFromPath(path.join(buildDir, behavior.tray.icon.file));

    if (behavior.tray.icon.template) {
        if (icon.isEmpty()) {
            icon = nativeImage.createFromPath(path.join(buildDir, 'icon.png'));

            if (!icon.isEmpty()) {
                icon = icon.resize({ width: 16, height: 16 });
            }
        }

        if (!icon.isEmpty()) {
            icon.setTemplateImage(true);
        }
    } else if (!icon.isEmpty()) {
        icon = icon.resize({ width: 16, height: 16 });
    }

    if (icon.isEmpty()) {
        log.warn('托盘图标加载失败，使用默认图标');
        icon = nativeImage.createEmpty();
    }

    tray = new Tray(icon);

    tray.setToolTip('飞牛影视');

    await updateTrayMenu();

    getUpdateChecker().downloadProgress.onChange(() => {
        updateTrayMenu().catch(error => log.error('刷新托盘菜单失败:', error));
    });

    tray.on(behavior.tray.restoreEvent as 'click', showMainWindow);

    provideTrayBalloon((content) => {
        tray?.displayBalloon({ iconType: 'info', title: '飞牛影视', content });
    });

    log.info('系统托盘创建成功');
}

export function destroyTray(): void {
    stopWatchingPendingUpdates();
    if (tray) {
        tray.destroy();
        tray = null;
        log.info('系统托盘已销毁');
    }
}

export function getTray(): Tray | null {
    return tray;
}
