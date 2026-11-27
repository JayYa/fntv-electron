import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import * as log from '../../modules/logger';
import {
    type Payload,
    type PushChannel,
    type Pushes,
    REQUEST_CALLERS,
    type RequestChannel,
    type Result,
    mayCall,
} from '../../public/ipcChannels';
import { isLoginPage } from '../common/loginPage';

export class InvalidPayload extends Error {}

export interface ChannelHandler<C extends RequestChannel> {
    parse(raw: unknown): Payload<C>;
    handle(payload: Payload<C>, event: IpcMainInvokeEvent): Result<C> | Promise<Result<C>>;
}

export type ChannelHandlers = { [C in RequestChannel]: ChannelHandler<C> };

export interface IpcDeps {
    isMainWindow(sender: WebContents): boolean;
}

export const noPayload = (raw: unknown): undefined => {
    if (raw !== undefined) throw new InvalidPayload('这个频道不接收参数');
    return undefined;
};

function callerOf(event: IpcMainInvokeEvent, deps: IpcDeps): 'loginPage' | 'webUi' | null {
    if (!deps.isMainWindow(event.sender)) return null;
    return isLoginPage(event) ? 'loginPage' : 'webUi';
}

function register<C extends RequestChannel>(channel: C, handler: ChannelHandler<C>, deps: IpcDeps): void {
    ipcMain.handle(channel, async (event, raw: unknown) => {
        const caller = callerOf(event, deps);
        if (caller === null || !mayCall(channel, caller)) {
            log.warn(`拒绝了 ${channel} 请求: 调用来源不是 ${REQUEST_CALLERS[channel]}`);
            throw new Error(`${channel} 不接受这个页面的请求`);
        }
        let payload: Payload<C>;
        try {
            payload = handler.parse(raw);
        } catch (error) {
            const reason = error instanceof InvalidPayload ? error.message : '参数无法解析';
            log.warn(`拒绝了 ${channel} 请求: ${reason}`);
            throw new Error(`${channel} 的参数不合法: ${reason}`);
        }
        try {
            return await handler.handle(payload, event);
        } catch (error) {
            log.error(`IPC 处理器执行失败: ${channel}`, error);
            throw error;
        }
    });
}

export function registerChannels(handlers: ChannelHandlers, deps: IpcDeps): void {
    for (const channel of Object.keys(handlers) as RequestChannel[]) {
        register(channel, handlers[channel] as ChannelHandler<typeof channel>, deps);
    }
}

export function push<C extends PushChannel>(webContents: WebContents, channel: C, payload: Pushes[C]): void {
    webContents.send(channel, payload);
}
