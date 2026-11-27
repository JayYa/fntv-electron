import { app, IpcMainEvent } from 'electron';
import { getInstance as getUpdateChecker } from '../../../modules/updater/updateChecker';
import { registerHandler } from '../core/ipcHandler';
import * as log from '../../../modules/logger';

const updateChecker = getUpdateChecker();

async function handleCheckUpdate(): Promise<void> {
    log.info('收到手动检查更新请求');
    await updateChecker.manualCheckForUpdates();
}

function handleGetVersion(event: IpcMainEvent): void {
    event.reply('version-info', {
        version: app.getVersion(),
        name: app.getName()
    });
}

function init(): void {
    registerHandler('check-update', handleCheckUpdate, { useHandle: true });
    registerHandler('get-version', handleGetVersion);
}

export {
    init
};
