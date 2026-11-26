import { mainWindow } from '../../common/mainWindow';
import { platformBehavior, PlatformBehavior } from '../../../public/platform';
import { registerHandler } from '../core/ipcHandler';
import * as log from '../../../modules/logger';

function handleMinimize(): void {
    log.info('窗口控制: 最小化');
    mainWindow.minimize();
}

function handleMaximize(): void {
    log.info('窗口控制: 最大化或还原');
    mainWindow.toggleMaximized();
}

function handleClose(): void {
    log.info('窗口控制: 关闭');
    mainWindow.close();
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
