import { ipcRenderer, type IpcRendererEvent } from 'electron';
import type { Payload, PushChannel, Pushes, RequestChannel, Result } from '../../public/ipcChannels';

type PayloadArgs<C extends RequestChannel> = Payload<C> extends undefined ? [] : [payload: Payload<C>];

export function request<C extends RequestChannel>(channel: C, ...[payload]: PayloadArgs<C>): Promise<Result<C>> {
    return payload === undefined ? ipcRenderer.invoke(channel) : ipcRenderer.invoke(channel, payload);
}

export function onPush<C extends PushChannel>(channel: C, listener: (payload: Pushes[C]) => void): () => void {
    const wrapped = (_event: IpcRendererEvent, payload: Pushes[C]) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.off(channel, wrapped);
}
