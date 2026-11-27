import { contextBridge } from 'electron';

import { isFnId } from '../public/fnId';
import { isPushChannel, mayCall, type PushChannel, type RequestChannel } from '../public/ipcChannels';
import { onPush, request } from './core/ipc';
import preloadLogger from './core/logger';
import type { LoginPageApi } from './core/types';

type PageListener = (payload: unknown) => void;
const unsubscribers = new Map<string, Map<PageListener, () => void>>();

function invoke(channel: string, payload?: unknown): Promise<unknown> {
    if (!mayCall(channel, 'loginPage')) throw new Error(`IPC channel not allowed: ${channel}`);
    return (request as (channel: RequestChannel, payload?: unknown) => Promise<unknown>)(channel as RequestChannel, payload);
}

function assertPushChannel(channel: string): asserts channel is PushChannel {
    if (!isPushChannel(channel)) throw new Error(`IPC channel not allowed: ${channel}`);
}

function exposeLoginPageApi(): void {
    if (window.location.protocol !== 'file:') return;

    const api: LoginPageApi = {
        invoke,
        on(channel: string, listener: PageListener) {
            assertPushChannel(channel);
            let channelListeners = unsubscribers.get(channel);
            if (!channelListeners) {
                channelListeners = new Map();
                unsubscribers.set(channel, channelListeners);
            }
            channelListeners.get(listener)?.();
            channelListeners.set(listener, onPush(channel, listener));
        },
        off(channel: string, listener: PageListener) {
            assertPushChannel(channel);
            unsubscribers.get(channel)?.get(listener)?.();
            unsubscribers.get(channel)?.delete(listener);
        },
        async openExternal(url: string) {
            await invoke('open-external', url);
        },
        isFnId,
    };

    contextBridge.exposeInMainWorld('electronAPI', api);
    contextBridge.exposeInMainWorld('log', preloadLogger);
    contextBridge.exposeInMainWorld('logger', preloadLogger);
}

exposeLoginPageApi();
