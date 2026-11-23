import { ipcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import * as log from '../../../modules/logger';

type IpcHandler = (event: IpcMainEvent, ...args: any[]) => void;
type IpcInvokeHandler = (event: IpcMainInvokeEvent, ...args: any[]) => any;

interface HandlerOptions {
    useHandle?: boolean;
}

const channels = new Set<string>();

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
    if (channels.has(channel)) {
        throw new Error(`Handler for channel "${channel}" already registered`);
    }
    channels.add(channel);

    if (options.useHandle) {
        ipcMain.handle(channel, guardInvokeHandler(channel, handler as IpcInvokeHandler));
    } else {
        ipcMain.on(channel, guardHandler(channel, handler as IpcHandler));
    }
}

export {
    registerHandler
};
