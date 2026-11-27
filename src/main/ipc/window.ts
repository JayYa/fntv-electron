import { mainWindow } from '../common/mainWindow';
import { platformBehavior } from '../../public/platform';
import * as log from '../../modules/logger';
import { type ChannelHandlers, noPayload } from './adapter';

export const windowHandlers: Pick<ChannelHandlers, 'window-minimize' | 'window-maximize' | 'window-close' | 'get-title-bar'> = {
    'window-minimize': {
        parse: noPayload,
        handle() {
            log.info('窗口控制: 最小化');
            mainWindow.minimize();
        },
    },
    'window-maximize': {
        parse: noPayload,
        handle() {
            log.info('窗口控制: 最大化或还原');
            mainWindow.toggleMaximized();
        },
    },
    'window-close': {
        parse: noPayload,
        handle() {
            log.info('窗口控制: 关闭');
            mainWindow.close();
        },
    },
    'get-title-bar': { parse: noPayload, handle: () => platformBehavior().titleBar },
};
