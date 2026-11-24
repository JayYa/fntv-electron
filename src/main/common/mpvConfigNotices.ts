import { dialog, shell } from 'electron';
import * as logger from '../../modules/logger';
import { acknowledgeConflicts } from './mpvConfigSync/installRecord';
import { type MergePrompt, mergePromptText } from './mpvConfigSync/mergePrompt';

let capabilitiesSatisfied = true;

export function setMpvCapabilitiesSatisfied(satisfied: boolean): void {
    capabilitiesSatisfied = satisfied;
}

export function mpvCapabilityTrayItems(): Electron.MenuItemConstructorOptions[] {
    if (capabilitiesSatisfied) return [];
    return [{ label: 'MPV 插件需要更新，片头片尾跳过等功能可能不可用（详见日志）', enabled: false }];
}

export function showMergePrompt(prompt: MergePrompt, mpvConfigDir: string): void {
    const text = mergePromptText(prompt);
    const files = prompt.conflicts.map(entry => entry.path).join(', ');
    logger.info(`MPV 配置有待合并的更新，弹出提示${prompt.migration ? '（首次迁移）' : ''}: ${files}`);
    dialog.showMessageBox({ type: 'info', ...text, buttons: ['打开配置目录', '知道了'], defaultId: 1, cancelId: 1 })
        .then(async ({ response }) => {
            acknowledgeConflicts(mpvConfigDir, prompt.conflicts);
            logger.info(`MPV 配置待合并更新提示已关闭，记为已确认: ${files}`);
            if (response !== 0) return;
            const error = await shell.openPath(mpvConfigDir);
            if (error) logger.error(`打开 MPV 用户配置目录失败: ${error}`, mpvConfigDir);
        })
        .catch(error => logger.error('MPV 配置待合并更新提示失败:', error));
}
