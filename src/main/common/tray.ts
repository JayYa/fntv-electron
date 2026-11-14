import { Tray, Menu, nativeImage, BrowserWindow, app, dialog, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getCurrentMpvPlayer, getMpvConfigDir, mpvCapabilityTrayItems } from '../handlers/plugins/mpvConfig';
import { getInstance as getUpdateChecker } from '../../modules/updater/updateChecker';
import { setMacCloseAction, getTrayNotificationShown, setTrayNotificationShown } from './preferences';
import * as log from '../../modules/logger';
import * as fnConfig from '../../modules/fn_config/config';
import { platformBehavior } from '../../public/platform';

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null; // 主窗口引用

// 不存在时只提示，不创建：空目录会让下次启动的同步按首次初始化处理。
async function openMpvConfigDir(mainWindow: BrowserWindow | null, dir: string): Promise<void> {
    if (!fs.existsSync(dir)) {
        const options: Electron.MessageBoxOptions = {
            type: 'info',
            title: 'MPV用户配置目录',
            message: 'MPV用户配置目录尚不存在',
            detail: `${dir}\n\n客户端启动时会把默认配置同步到这里。`,
        };
        await (mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options));
        return;
    }
    const error = await shell.openPath(dir);
    if (error) {
        log.error(`打开MPV用户配置目录失败: ${error}`, dir);
        dialog.showErrorBox('打开MPV用户配置目录失败', `${error}\n\n${dir}`);
    }
}

/**
 * 创建设置子菜单
 */
async function createSettingsSubmenu(mainWindow: BrowserWindow | null): Promise<Electron.MenuItemConstructorOptions[]> {
    // 获取当前配置
    const proxyConfig = fnConfig.getAppDownloadProxyConfig();
    const mpvEnabled = fnConfig.getHideOriginalPlayButton();
    const nasProxyEnabled = fnConfig.getNasProxyEnabled();
    const currentMpvPath = fnConfig.getMpvPlayerPath();
    const playerPath = getCurrentMpvPlayer()?.path;
    // 取不到目录（Windows 上 app.getPath('appData') 可能失败）时只让这一项不可用，托盘和启动照常。
    let mpvConfigDir: string | undefined;
    try {
        mpvConfigDir = getMpvConfigDir(currentMpvPath);
    } catch (error) {
        log.error('获取MPV用户配置目录失败', error);
    }

    const submenu: Electron.MenuItemConstructorOptions[] = [
        {
            label: `应用更新下载加速: ${proxyConfig.enabled ? '开启' : '关闭'}`,
            type: 'checkbox',
            checked: proxyConfig.enabled,
            click: () => {
                const newEnabled = !proxyConfig.enabled;
                fnConfig.setAppDownloadProxyConfig({ enabled: newEnabled, proxyUrl: proxyConfig.proxyUrl });
                // 更新托盘菜单以刷新状态
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
                fnConfig.setHideOriginalPlayButton(!mpvEnabled);
                // 更新托盘菜单以刷新状态
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
                fnConfig.setNasProxyEnabled(newEnabled);
                // 更新托盘菜单以刷新状态
                updateTrayMenu();
            }
        },
        {
            type: 'separator'
        },
        {
            label: `设置MPV播放器路径 (${playerPath ?? '未找到'})`,
            click: async () => {
                if (mainWindow) {
                    const result = await dialog.showOpenDialog(mainWindow, {
                        title: '选择MPV播放器',
                        // Electron 43 起不传 defaultPath 时总是从“下载”目录开始，系统不再记住上次的目录。
                        defaultPath: currentMpvPath ? path.dirname(currentMpvPath) : undefined,
                        properties: ['openFile'],
                        filters: [
                            { name: '可执行文件', extensions: platformBehavior().mpvExecutableExtensions },
                            { name: '所有文件', extensions: ['*'] }
                        ]
                    });

                    if (!result.canceled && result.filePaths.length > 0) {
                        const selectedPath = result.filePaths[0];
                        fnConfig.setMpvPlayerPath(selectedPath);
                        log.info(`MPV播放器路径已设置为: ${selectedPath}`);

                        // 更新托盘菜单以显示新路径
                        updateTrayMenu();
                    }
                }
            }
        },
        {
            label: '清空MPV播放器路径',
            enabled: !!currentMpvPath, // 只有当有设置路径时才启用
            click: () => {
                fnConfig.setMpvPlayerPath(''); // 清空配置中的路径
                log.info('MPV播放器路径已清空，将使用自动检测');

                // 更新托盘菜单以刷新状态
                updateTrayMenu();
            }
        },
        {
            // 按当前设置算出的目录，是下次播放时 MPV 读的目录；改了自选 MPV 后要重启客户端才会同步到这里。
            label: `打开MPV用户配置目录 (${mpvConfigDir ?? '无法确定'})`,
            enabled: mpvConfigDir !== undefined,
            click: () => (mpvConfigDir ? openMpvConfigDir(mainWindow, mpvConfigDir) : undefined),
        },
        ...mpvCapabilityTrayItems(),
    ];

    return submenu;
}

/** 应用内更新下载中时，「检查更新」项后面显示下载百分比 */
function checkForUpdatesLabel(downloadPercent: number | null): string {
    return downloadPercent === null ? '检查更新' : `检查更新（正在下载新版本 ${downloadPercent}%）`;
}

/**
 * 更新托盘菜单
 */
async function updateTrayMenu(): Promise<void> {
    if (!tray) return;
    const behavior = platformBehavior();

    // 创建托盘菜单
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
            click: () => {
                if (mainWindow) {
                    if (mainWindow.isMinimized()) mainWindow.restore();
                    if (!mainWindow.isVisible()) mainWindow.show();
                    mainWindow.focus();

                    // macOS 特有：确保应用在 dock 中显示
                    if (behavior.hasDock) {
                        app.dock?.show();
                    }
                }
            }
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
        }
    ];

    // 在 macOS 上添加偏好设置选项
    if (behavior.closeBehaviorSetting === 'macCloseAction') {
        menuTemplate.push(
            {
                type: 'separator'
            },
            {
                label: '关闭行为设置',
                click: async () => {
                    if (mainWindow) {
                        const result = await dialog.showMessageBox(mainWindow, {
                            type: 'question',
                            title: '关闭行为设置',
                            message: '设置点击关闭按钮时的行为',
                            detail: '您可以选择关闭窗口时的默认行为。',
                            buttons: ['隐藏到状态栏', '退出应用', '每次询问', '取消'],
                            defaultId: 2,
                            cancelId: 3
                        });

                        switch (result.response) {
                            case 0:
                                setMacCloseAction('minimize');
                                break;
                            case 1:
                                setMacCloseAction('quit');
                                break;
                            case 2:
                                setMacCloseAction('ask');
                                break;
                        }
                    }
                }
            }
        );
    } else {
        // Windows 和 Linux 上添加退出模式设置
        menuTemplate.push(
            {
                type: 'separator'
            },
            {
                label: '退出行为设置',
                click: async () => {
                    if (mainWindow) {
                        const result = await dialog.showMessageBox(mainWindow, {
                            type: 'question',
                            title: '退出行为设置',
                            message: '设置点击退出时的行为',
                            detail: '您可以选择单击退出时的默认行为。',
                            buttons: ['直接退出', '最小化到托盘', '每次询问', '取消'],
                            defaultId: 2,
                            cancelId: 3
                        });

                        switch (result.response) {
                            case 0:
                                fnConfig.setExitMode('direct');
                                break;
                            case 1:
                                fnConfig.setExitMode('minimize');
                                break;
                            case 2:
                                fnConfig.setExitMode('ask');
                                break;
                        }
                    }
                }
            }
        );
    }

    menuTemplate.push(
        {
            type: 'separator'
        },
        {
            label: behavior.tray.quitLabel,
            click: () => {
                // 托盘菜单中的退出按钮直接退出应用
                (app as any).isQuiting = true;
                app.quit();
            }
        }
    );

    const contextMenu = Menu.buildFromTemplate(menuTemplate);

    // 更新托盘菜单
    tray.setContextMenu(contextMenu);
}

/**
 * 创建系统托盘
 * @param {BrowserWindow} mainWindow - 主窗口实例
 */
export async function createTray(mainWindowInstance: BrowserWindow): Promise<void> {
    // 保存窗口引用
    mainWindow = mainWindowInstance;

    // 根据平台选择合适的图标
    const behavior = platformBehavior();
    const buildDir = path.join(__dirname, '../../../build');
    let icon = nativeImage.createFromPath(path.join(buildDir, behavior.tray.icon.file));

    if (behavior.tray.icon.template) {
        // macOS 推荐用 template 图标
        if (icon.isEmpty()) {
            // fallback: 用通用图标
            icon = nativeImage.createFromPath(path.join(buildDir, 'icon.png'));

            if (!icon.isEmpty()) {
                // 尺寸适配状态栏（通常 16x16 即可，Retina 自动缩放）
                icon = icon.resize({ width: 16, height: 16 });
            }
        }

        if (!icon.isEmpty()) {
            icon.setTemplateImage(true); // 关键：启用 macOS 自动浅色/深色模式适配
        }
    } else if (!icon.isEmpty()) {
        // Windows 用 ICO，Linux 用 PNG
        icon = icon.resize({ width: 16, height: 16 });
    }

    // 如果图标仍然为空，记录错误但继续创建托盘
    if (icon.isEmpty()) {
        log.warn('托盘图标加载失败，使用默认图标');
        // 创建一个简单的默认图标
        icon = nativeImage.createEmpty();
    }

    tray = new Tray(icon);

    // 设置托盘提示文字
    tray.setToolTip('飞牛影视');

    // 初始创建菜单
    await updateTrayMenu();

    // 下载百分比变了就重建菜单，刷新「检查更新」项
    getUpdateChecker().downloadProgress.onChange(() => {
        updateTrayMenu().catch(error => log.error('刷新托盘菜单失败:', error));
    });

    // 根据平台设置不同的恢复窗口操作：Windows 双击，macOS 和 Linux 单击
    tray.on(behavior.tray.restoreEvent as 'click', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            if (!mainWindow.isVisible()) mainWindow.show();
            mainWindow.focus();
            if (behavior.hasDock) app.dock?.show();
        }
    });

    log.info('系统托盘创建成功');
}

/**
 * 显示托盘通知（仅在Windows上首次显示）
 */
export function showTrayNotification(): void {
    if (platformBehavior().tray.showsMinimizeBalloon && !getTrayNotificationShown() && tray) {
        tray.displayBalloon({
            iconType: 'info',
            title: '飞牛影视',
            content: '应用已最小化到托盘，双击托盘图标或右键菜单可以恢复窗口'
        });
        setTrayNotificationShown(true); // 标记已显示过提示
    }
}

/**
 * 销毁托盘
 */
export function destroyTray(): void {
    if (tray) {
        tray.destroy();
        tray = null;
        log.info('系统托盘已销毁');
    }
}

/**
 * 获取托盘实例
 * @returns {Tray|null} 托盘实例
 */
export function getTray(): Tray | null {
    return tray;
}
