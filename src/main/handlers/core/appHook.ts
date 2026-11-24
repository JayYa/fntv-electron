import { app } from 'electron';
import * as log from '../../../modules/logger';

type HookType = 'ready' | 'activate';

interface Hooks {
    ready: Array<(...args: any[]) => void>;
    activate: Array<(...args: any[]) => void>;
}

const hooks: Hooks = {
    ready: [],
    activate: []
};

function registerAppHook(type: HookType, fn: (...args: any[]) => void): void {
    if (!hooks[type]) {
        throw new Error(`Unknown app hook type: ${type}`);
    }
    hooks[type].push(fn);
}

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
