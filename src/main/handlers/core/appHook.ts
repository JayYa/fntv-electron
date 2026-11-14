import { app } from 'electron';
import * as log from '../../../modules/logger';

/**
 * 应用生命周期钩子管理器
 */

// 没有 windowAllClosed：window-all-closed 只在 src/main/main.ts 监听一处（#76）。
// 没有 beforeQuit：退出时要做的事向退出协调注册（src/modules/quit/quitCoordinator.ts）。
type HookType = 'ready' | 'activate';

interface Hooks {
    ready: Array<(...args: any[]) => void>;
    activate: Array<(...args: any[]) => void>;
}

const hooks: Hooks = {
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
