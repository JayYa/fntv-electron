export enum HookType {
    OnReady = 'onReady',
    OnDomChange = 'onDomChange'
}

export interface HookUtils {
    registerHook: (type: HookType, fn: (...args: any[]) => void) => void;
    runHooks: (type: HookType, ...args: any[]) => void;
}

export type Hooks = {
    [K in HookType]: Array<(...args: any[]) => void>;
}

const hooks: Hooks = Object.values(HookType).reduce((acc, hookType) => {
    acc[hookType] = [];
    return acc;
}, {} as Hooks);

function registerHook(type: HookType, fn: (...args: any[]) => void): void {
    if (!hooks[type]) {
        throw new Error(`Unknown hook type: ${type}`);
    }
    hooks[type].push(fn);
}

function runHooks(type: HookType, ...args: any[]): void {
    if (!hooks[type]) return;
    hooks[type].forEach(fn => fn(...args));
}

const hookUtils: HookUtils = {
    registerHook,
    runHooks
};

export { registerHook, runHooks };
export default hookUtils;
