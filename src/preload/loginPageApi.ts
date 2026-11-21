import { contextBridge, ipcRenderer } from 'electron';

import preloadLogger from './core/logger';
import type { LoginPageApi } from './core/types';

const SEND_CHANNELS = new Set([
    'delete-history-item', 'clear-history', 'get-config',
    'get-history-credentials', 'get-current-access-code',
    'get-version', 'get-download-proxy', 'get-play-button-config',
]);
const RECEIVE_CHANNELS = new Set([
    'config-data', 'history-credentials', 'current-access-code',
    'history-item-deleted',
    'version-info', 'update-status', 'download-proxy-info', 'play-button-config-info',
]);
const INVOKE_CHANNELS = new Set([
    'open-external', 'login', 'check-update', 'set-download-proxy', 'set-play-button-config',
]);
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

    const api: LoginPageApi = {
        send(channel: string, ...args: unknown[]) {
            assertAllowed(SEND_CHANNELS, channel);
            ipcRenderer.send(channel, ...args);
        },
        invoke(channel: string, ...args: unknown[]) {
            return invokeAllowed(channel, ...args);
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
        async openExternal(url: string) {
            await invokeAllowed('open-external', url);
        },
    };

    contextBridge.exposeInMainWorld('electronAPI', api);
    contextBridge.exposeInMainWorld('log', preloadLogger);
    contextBridge.exposeInMainWorld('logger', preloadLogger);
}

exposeLoginPageApi();
