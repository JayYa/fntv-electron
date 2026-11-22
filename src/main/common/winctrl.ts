import * as log from '../../modules/logger';
import { readCurrentLogin } from '../../modules/fn_config/loginStore';
import { BrowserWindow, dialog } from 'electron';
import { restoreCurrentLogin, showLoginPage } from './currentLogin';
import { shouldStartMaximized } from './mainwin';

export function unmaximizeWindow(mainWindow: BrowserWindow): void {
    if (mainWindow) mainWindow.unmaximize();
}

/**
 * 设置窗口为全屏
 * @param {Electron.BrowserWindow} mainWindow - 主窗口实例
 */
export function setFullScreen(mainWindow: BrowserWindow): void {
    if (mainWindow) mainWindow.maximize();
}

/**
 * 设置全屏切换
 * @param {Electron.BrowserWindow} mainWindow - 主窗口实例
 */
export function setupFullScreenToggle(mainWindow: BrowserWindow): void {
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.key === 'F11') {
            if (mainWindow.isMaximized()) {
                unmaximizeWindow(mainWindow);
            } else {
                setFullScreen(mainWindow);
            }
            event.preventDefault();
        }
    });
}

/**
 * 设置窗口显示事件
 * @param {Electron.BrowserWindow} mainWindow - 主窗口实例
 */
export function setupWindowShowEvents(mainWindow: BrowserWindow): void {
    mainWindow.once('ready-to-show', () => {
        if (shouldStartMaximized()) mainWindow.maximize();
        mainWindow.show();
    });
}

/**
 * 设置 cookie 恢复
 * @param {Electron.BrowserWindow} mainWindow - 主窗口实例
 */
export async function setupCookieRestore(mainWindow: BrowserWindow): Promise<void> {
    // 从配置中恢复 cookie
    let savedLogin;
    try {
        savedLogin = await readCurrentLogin();
    } catch (error) {
        const message = error instanceof Error ? error.message : '无法读取配置文件';
        log.error('读取配置失败:', error);
        await dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: '无法读取配置',
            message,
            detail: '请检查配置文件 ~/.fntv/config.json 是否可读，然后重新登录。',
        });
        showLoginPage(mainWindow);
        return;
    }
    if (!savedLogin || !savedLogin.token || !savedLogin.domain) {
        log.warn('没有找到已保存的配置，无法恢复 cookie');
        showLoginPage(mainWindow);
        return;
    }

    const result = await restoreCurrentLogin(() => mainWindow, {
        baseUrl: savedLogin.domain,
        accessCode: savedLogin.accessCode || '',
        account: savedLogin.account || '',
        savedToken: savedLogin.token,
    });
    if (!result.ok) {
        log.warn('恢复当前登录失败，跳转到登录页面:', result.reason);
        showLoginPage(mainWindow);
    }
}
