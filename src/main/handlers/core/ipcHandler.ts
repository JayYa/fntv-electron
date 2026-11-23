import { ipcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import * as log from '../../../modules/logger';

type IpcHandler = (event: IpcMainEvent, ...args: any[]) => void;
type IpcInvokeHandler = (event: IpcMainInvokeEvent, ...args: any[]) => any;

interface HandlerOptions {
    useHandle?: boolean;
}

interface HandlerInfo {
    handler: IpcHandler | IpcInvokeHandler;
    options: HandlerOptions;
}

const handlers = new Map<string, HandlerInfo>();

function guardHandler(channel: string, handler: IpcHandler): IpcHandler {
    return async (event, ...args) => {
        try {
            await handler(event, ...args);
        } catch (error) {
            log.error(`IPC 处理器执行失败: ${channel}`, error);
        }
    };
}

function guardInvokeHandler(channel: string, handler: IpcInvokeHandler): IpcInvokeHandler {
    return async (event, ...args) => {
        try {
            return await handler(event, ...args);
        } catch (error) {
            log.error(`IPC 处理器执行失败: ${channel}`, error);
            throw error;
        }
    };
}

function registerHandler(channel: string, handler: IpcHandler | IpcInvokeHandler, options: HandlerOptions = {}): void {
    if (handlers.has(channel)) {
        throw new Error(`Handler for channel "${channel}" already registered`);
    }
    
    handlers.set(channel, { handler, options });
    
    if (options.useHandle) {
        ipcMain.handle(channel, guardInvokeHandler(channel, handler as IpcInvokeHandler));
    } else {
        ipcMain.on(channel, guardHandler(channel, handler as IpcHandler));
    }
}

function removeHandler(channel: string): void {
    if (handlers.has(channel)) {
        ipcMain.removeAllListeners(channel);
        handlers.delete(channel);
    }
}

function getRegisteredHandlers(): string[] {
    return Array.from(handlers.keys());
}

function clearAllHandlers(): void {
    handlers.forEach((_, channel) => {
        ipcMain.removeAllListeners(channel);
    });
    handlers.clear();
}

export {
    registerHandler,
    removeHandler,
    getRegisteredHandlers,
    clearAllHandlers
};
