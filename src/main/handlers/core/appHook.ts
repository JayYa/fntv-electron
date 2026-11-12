import { app } from 'electron';
import * as log from '../../../modules/logger';

/**
 * 应用生命周期钩子管理器
 */

// 没有 windowAllClosed：window-all-closed 只在 src/main/main.ts 监听一处（#76）。
type HookType = 'beforeQuit' | 'ready' | 'activate';

interface Hooks {
    beforeQuit: Array<(...args: any[]) => void>;
    ready: Array<(...args: any[]) => void>;
    activate: Array<(...args: any[]) => void>;
}

const hooks: Hooks = {
    beforeQuit: [],
    ready: [],
    activate: []
};

/**
 * 注册应用生命周期钩子
 * @param type - 钩子类型
 * @param fn - 回调函数
 */
function registerAppHook(type: HookType, fn: (...args: any[]) => void): void {
    if (!hooks[type]) {
        throw new Error(`Unknown app hook type: ${type}`);
    }
    hooks[type].push(fn);
}

/**
 * 执行指定类型的钩子
 * @param type - 钩子类型
 * @param args - 传递给钩子函数的参数
 */
function runAppHooks(type: HookType, ...args: any[]): void {
    if (!hooks[type]) return;
    
    hooks[type].forEach(fn => {
        try {
            fn(...args);
        } catch (error) {
            log.error(`Error running ${type} hook:`, error);
        }
    });
}

/**
 * 初始化应用钩子
 */
function initAppHooks(): void {
    // 钩子拿到 before-quit 的事件对象，退出被拦下时（event.defaultPrevented）可以先不收尾
    app.on('before-quit', (event) => {
        runAppHooks('beforeQuit', event);
    });
    
    app.on('ready', () => {
        runAppHooks('ready');
    });
    
    app.on('activate', () => {
        runAppHooks('activate');
    });
}

export {
    registerAppHook,
    runAppHooks,
    initAppHooks
};
