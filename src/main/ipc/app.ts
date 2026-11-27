import { app, shell } from 'electron';
import { getInstance as getUpdateChecker } from '../../modules/updater/updateChecker';
import * as log from '../../modules/logger';
import { resolveAllowedExternalUrl } from '../common/externalUrl';
import { type ChannelHandlers, InvalidPayload, noPayload } from './adapter';

function parseExternalUrl(raw: unknown): string {
    const target = resolveAllowedExternalUrl(raw);
    if (!target) throw new InvalidPayload('仅允许打开 GitHub HTTPS 链接');
    return target;
}

async function openExternal(target: string): Promise<void> {
    await shell.openExternal(target);
    log.info('已打开外链');
}

async function checkForUpdates(): Promise<void> {
    log.info('收到手动检查更新请求');
    await getUpdateChecker().manualCheckForUpdates();
}

export const appHandlers: Pick<ChannelHandlers, 'open-external' | 'check-update' | 'get-version'> = {
    'open-external': { parse: parseExternalUrl, handle: openExternal },
    'check-update': { parse: noPayload, handle: checkForUpdates },
    'get-version': { parse: noPayload, handle: () => ({ version: app.getVersion(), name: app.getName() }) },
};
