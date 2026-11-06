import { contextBridge, ipcRenderer } from 'electron';

import { HookType, runHooks } from './core/hooks';

// 导入渲染进程日志模块
import preloadLogger from './core/logger';

// 沙箱里不能读目录，也不能 require 相对路径，插件只能静态导入。新增插件时在这里加一行。
// 保持字母序，和原来 readdirSync 的加载顺序一致（tests/preloadBundle.test.cjs）。
import './plugins/continueWatchingMenu';
import './plugins/playButton';
import './plugins/playMaskButton';
import './plugins/titlebar';

const SEND_CHANNELS = new Set([
    'login', 'delete-history-item', 'clear-history', 'get-config',
    'get-history-credentials', 'get-current-access-code',
    'get-version', 'check-update', 'get-download-proxy', 'get-play-button-config',
    'set-download-proxy', 'set-play-button-config',
]);
const RECEIVE_CHANNELS = new Set([
    'config-data', 'history-credentials', 'current-access-code',
    'history-item-deleted', 'login-error', 'login-success',
    'version-info', 'update-status', 'download-proxy-info', 'play-button-config-info',
    'download-proxy-set', 'play-button-config-set',
]);
const INVOKE_CHANNELS = new Set(['open-external']);
type PageListener = (...args: unknown[]) => void;
const listenerWrappers = new Map<string, Map<PageListener, (...args: unknown[]) => void>>();

function assertAllowed(channels: Set<string>, channel: string): void {
    if (!channels.has(channel)) throw new Error(`IPC channel not allowed: ${channel}`);
}

function invokeAllowed(channel: string, ...args: unknown[]): Promise<unknown> {
    assertAllowed(INVOKE_CHANNELS, channel);
    return ipcRenderer.invoke(channel, ...args);
}

function wrapListener(channel: string, listener: PageListener): (...args: unknown[]) => void {
    const wrapped = (_event: unknown, ...args: unknown[]) => listener(undefined, ...args);
    let channelListeners = listenerWrappers.get(channel);
    if (!channelListeners) {
        channelListeners = new Map();
        listenerWrappers.set(channel, channelListeners);
    }
    channelListeners.set(listener, wrapped);
    return wrapped;
}

function exposeLoginPageApi(): void {
    if (window.location.protocol !== 'file:') return;

    const api = {
        send(channel: string, ...args: unknown[]) {
            assertAllowed(SEND_CHANNELS, channel);
            ipcRenderer.send(channel, ...args);
        },
        on(channel: string, listener: PageListener) {
            assertAllowed(RECEIVE_CHANNELS, channel);
            ipcRenderer.on(channel, wrapListener(channel, listener));
        },
        once(channel: string, listener: PageListener) {
            assertAllowed(RECEIVE_CHANNELS, channel);
            ipcRenderer.once(channel, wrapListener(channel, listener));
        },
        off(channel: string, listener: PageListener) {
            assertAllowed(RECEIVE_CHANNELS, channel);
            const wrapped = listenerWrappers.get(channel)?.get(listener);
            if (!wrapped) return;
            ipcRenderer.off(channel, wrapped);
            listenerWrappers.get(channel)?.delete(listener);
        },
        // 沙箱里没有 shell，地址和来源都由主进程校验（src/main/handlers/plugins/externalLink.ts）。
        async openExternal(url: string) {
            await invokeAllowed('open-external', url);
        },
    };

    contextBridge.exposeInMainWorld('electronAPI', api);
    contextBridge.exposeInMainWorld('log', preloadLogger);
    contextBridge.exposeInMainWorld('logger', preloadLogger);
}

exposeLoginPageApi();

function initInjector(): void {
    if (document.readyState !== 'loading') {
        runHooks(HookType.OnReady);
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            runHooks(HookType.OnReady);
            const observer = new MutationObserver(() => runHooks(HookType.OnDomChange));
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }
}

initInjector();
