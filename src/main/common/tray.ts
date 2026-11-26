import { Tray, Menu, nativeImage, app, dialog, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { mpvRuntime, type MpvUserConfig } from './mpvRuntime';
import { getInstance as getUpdateChecker } from '../../modules/updater/updateChecker';
import { mainWindow } from './mainWindow';
import * as log from '../../modules/logger';
import * as preferences from '../../modules/fn_config/preferences';
import { platformBehavior } from '../../public/platform';

let tray: Tray | null = null;
let stopWatchingPreferences: (() => void) | null = null;

async function openMpvConfigDir(dir: string): Promise<void> {
    if (!fs.existsSync(dir)) {
        const options: Electron.MessageBoxOptions = {
            type: 'info',
            title: 'MPV 用户配置目录',
            message: 'MPV 用户配置目录尚不存在',
            detail: `${dir}\n\n客户端启动时会把默认配置同步到这里。`,
        };
        await dialog.showMessageBox(mainWindow.window(), options);
        return;
    }
    const error = await shell.openPath(dir);
    if (error) {
        log.error(`打开 MPV 用户配置目录失败: ${error}`, dir);
        dialog.showErrorBox('打开 MPV 用户配置目录失败', `${error}\n\n${dir}`);
    }
}

function pendingMpvUpdatesItems(userConfig: MpvUserConfig | undefined): Electron.MenuItemConstructorOptions[] {
    if (!userConfig || userConfig.pendingUpdates === 0) return [];
    return [{
        label: `MPV 配置有 ${userConfig.pendingUpdates} 个待合并的更新`,
        click: () => openMpvConfigDir(userConfig.dir),
    }];
}

function mpvCapabilityItems(): Electron.MenuItemConstructorOptions[] {
    if (mpvRuntime.capabilitiesSatisfied()) return [];
    return [{ label: 'MPV 插件需要更新，片头片尾跳过等功能可能不可用（详见日志）', enabled: false }];
}

async function createPreferencesSubmenu(): Promise<Electron.MenuItemConstructorOptions[]> {
    const proxyConfig = preferences.get('appDownloadProxy');
    const mpvEnabled = preferences.get('mpvPlayback');
    const nasProxyEnabled = preferences.get('nasLocalProxy');
    const currentMpvPath = preferences.get('userMpvPath');
    const programPath = mpvRuntime.program()?.path;
    const userConfig = mpvRuntime.userConfig();
    const mpvConfigDir = userConfig?.dir;

    const submenu: Electron.MenuItemConstructorOptions[] = [
        {
            label: `应用更新下载加速: ${proxyConfig.enabled ? '开启' : '关闭'}`,
            type: 'checkbox',
            checked: proxyConfig.enabled,
            click: () => {
                const current = preferences.get('appDownloadProxy');
                preferences.set('appDownloadProxy', { ...current, enabled: !current.enabled });
            }
        },
        {
            type: 'separator'
        },
        {
            label: `使用 MPV 播放`,
            type: 'checkbox',
            checked: mpvEnabled,
            click: () => preferences.set('mpvPlayback', !preferences.get('mpvPlayback')),
        },
        {
            type: 'separator'
        },
        {
            label: `NAS 中转 网盘/STRM: ${nasProxyEnabled ? '开启' : '关闭'}`,
            type: 'checkbox',
            checked: nasProxyEnabled,
            click: () => preferences.set('nasLocalProxy', !preferences.get('nasLocalProxy')),
        },
        {
            type: 'separator'
        },
        {
            label: `设置 MPV 播放器路径 (${programPath ?? '未找到'})`,
            click: async () => {
                const result = await dialog.showOpenDialog(mainWindow.window(), {
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
                    preferences.set('userMpvPath', selectedPath);
                    log.info(`MPV 播放器路径已设置为: ${selectedPath}`);
                }
            }
        },
        {
            label: '清空 MPV 播放器路径',
            enabled: !!currentMpvPath,
            click: () => {
                preferences.set('userMpvPath', undefined);
                log.info('MPV 播放器路径已清空，将使用自动检测');
            }
        },
        {
            label: `打开 MPV 用户配置目录 (${mpvConfigDir ?? '无法确定'})`,
            enabled: mpvConfigDir !== undefined,
            click: () => (mpvConfigDir ? openMpvConfigDir(mpvConfigDir) : undefined),
        },
        ...pendingMpvUpdatesItems(userConfig),
        ...mpvCapabilityItems(),
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
            submenu: await createPreferencesSubmenu()
        },
        {
            type: 'separator'
        },
        {
            label: behavior.tray.showWindowLabel,
            click: () => mainWindow.show(),
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
        mainWindow.closeBehaviorMenuItem(),
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

export async function createTray(): Promise<void> {
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

    const refreshMenu = (): void => {
        updateTrayMenu().catch(error => log.error('刷新托盘菜单失败:', error));
    };
    mpvRuntime.onPendingUpdatesChange(refreshMenu);
    stopWatchingPreferences = preferences.onChange(refreshMenu);

    await updateTrayMenu();

    getUpdateChecker().downloadProgress.onChange(refreshMenu);

    tray.on(behavior.tray.restoreEvent as 'click', () => mainWindow.show());

    log.info('系统托盘创建成功');
}

export function showTrayBalloon(content: string): void {
    tray?.displayBalloon({ iconType: 'info', title: '飞牛影视', content });
}

export function destroyTray(): void {
    mpvRuntime.stop();
    stopWatchingPreferences?.();
    stopWatchingPreferences = null;
    if (tray) {
        tray.destroy();
        tray = null;
        log.info('系统托盘已销毁');
    }
}

export function getTray(): Tray | null {
    return tray;
}
