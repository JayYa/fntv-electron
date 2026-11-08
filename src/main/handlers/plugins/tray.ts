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
function handleBeforeQuit(): void {
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
