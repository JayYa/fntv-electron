import { type IpcDeps, registerChannels } from './adapter';
import { appHandlers } from './app';
import { loginHandlers } from './login';
import { playbackHandlers } from './playback';
import { preferencesHandlers } from './preferences';
import { rendererHandlers } from './renderer';
import { windowHandlers } from './window';

export function startIpc(deps: IpcDeps): void {
    registerChannels({
        ...appHandlers,
        ...loginHandlers,
        ...playbackHandlers,
        ...preferencesHandlers,
        ...rendererHandlers,
        ...windowHandlers,
    }, deps);
}
