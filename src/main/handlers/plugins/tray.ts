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

// 注册 before-quit 事件
function handleBeforeQuit(event: Electron.Event): void {
    // 应用内更新「退出时安装」会先拦下退出，停止 MPV、等进度回传后再重新退出；
    // 这次先不销毁托盘，安装期间托盘图标还在（src/modules/updater/inAppUpdate.ts）
    if (event.defaultPrevented) return;
    (app as any).isQuiting = true;
    destroyTray();
}

// 注册更新相关处理器
function init(): void {
    registerAppHook('beforeQuit', handleBeforeQuit);
}

export {
    init
};
