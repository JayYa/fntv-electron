import { getMainWindow } from '../../common/mainwin';
import { setHalfScreen, setFullScreen } from '../../common/winctrl';
import { registerHandler } from '../core/ipcHandler';
import * as log from '../../../modules/logger';

/**
 * 窗口控制插件
 * 处理窗口的最小化、最大化和关闭操作
 */

// 窗口最小化处理
function handleMinimize(): void {
    log.info('窗口控制: 最小化');
    const mainWindow = getMainWindow();
    if (mainWindow) mainWindow.minimize();
}

// 窗口最大化/还原处理
function handleMaximize(): void {
    log.info('窗口控制: 最大化或还原');
    const mainWindow = getMainWindow();
    if (mainWindow) {
        mainWindow.isMaximized() ? setHalfScreen(mainWindow) : setFullScreen(mainWindow);
    }
}

// 窗口关闭处理
function handleClose(): void {
    log.info('窗口控制: 关闭');
    const mainWindow = getMainWindow();
    if (mainWindow) mainWindow.close();
}

// 注册窗口控制处理器
function init(): void {
    registerHandler('window-minimize', handleMinimize);
    registerHandler('window-maximize', handleMaximize);
    registerHandler('window-close', handleClose);
}

export {
    init
};
