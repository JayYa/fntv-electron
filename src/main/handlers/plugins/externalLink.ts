import { IpcMainInvokeEvent, shell } from 'electron';
import { resolveAllowedExternalUrl } from '../../common/externalUrl';
import { isLoginPage } from '../../common/loginPage';
import { registerHandler } from '../core/ipcHandler';
import * as log from '../../../modules/logger';

async function handleOpenExternal(event: IpcMainInvokeEvent, url: unknown): Promise<void> {
    if (!isLoginPage(event)) {
        log.warn('拒绝打开外链: 请求不是来自登录页');
        throw new Error('仅登录页可以打开外部链接');
    }

    const target = resolveAllowedExternalUrl(url);
    if (!target) {
        log.warn('拒绝打开外链: 不是 GitHub HTTPS 地址');
        throw new Error('仅允许打开 GitHub HTTPS 链接');
    }

    await shell.openExternal(target);
    log.info('已打开外链');
}

function init(): void {
    registerHandler('open-external', handleOpenExternal, { useHandle: true });
}

export {
    init
};
