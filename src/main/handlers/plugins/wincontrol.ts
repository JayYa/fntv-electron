import { getMainWindow } from '../../common/mainwin';
import { unmaximizeWindow, setFullScreen } from '../../common/winctrl';
import { platformBehavior, PlatformBehavior } from '../../../public/platform';
import { registerHandler } from '../core/ipcHandler';
import * as log from '../../../modules/logger';

function handleMinimize(): void {
    log.info('窗口控制: 最小化');
    const mainWindow = getMainWindow();
    if (mainWindow) mainWindow.minimize();
}

function handleMaximize(): void {
    log.info('窗口控制: 最大化或还原');
    const mainWindow = getMainWindow();
    if (mainWindow) {
        mainWindow.isMaximized() ? unmaximizeWindow(mainWindow) : setFullScreen(mainWindow);
    }
}

function handleClose(): void {
    log.info('窗口控制: 关闭');
    const mainWindow = getMainWindow();
    if (mainWindow) mainWindow.close();
}

function handleGetTitleBar(): PlatformBehavior['titleBar'] {
    return platformBehavior().titleBar;
}

function init(): void {
    registerHandler('window-minimize', handleMinimize);
    registerHandler('window-maximize', handleMaximize);
    registerHandler('window-close', handleClose);
    registerHandler('get-title-bar', handleGetTitleBar, { useHandle: true });
}

export {
    init
};
