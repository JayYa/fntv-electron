import { app } from 'electron';
import { registerAppHook } from '../core/appHook';
import { destroyTray } from '../../common/tray';

declare global {
    namespace NodeJS {
        interface Global {
            app: {
                isQuiting?: boolean;
            };
        }
    }
}

// 注册 window-all-closed 事件
// 各平台相同：没有明确退出时保持运行（Windows、Linux 留在托盘，macOS 留在状态栏和 dock）。
function handleWindowAllClosed(): void {
    if (!(app as any).isQuiting) {
        return;
    }
    app.quit();
}

// 注册 before-quit 事件
function handleBeforeQuit(): void {
    (app as any).isQuiting = true;
    destroyTray();
}

// 注册更新相关处理器
function init(): void {
    registerAppHook('windowAllClosed', handleWindowAllClosed);
    registerAppHook('beforeQuit', handleBeforeQuit);
}

export {
    init
};
