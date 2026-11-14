import { dialog, shell } from 'electron';
import * as logger from '../../modules/logger';
import { acknowledgeConflicts } from './mpvConfigSync/installRecord';
import { type MergePrompt, mergePromptText } from './mpvConfigSync/mergePrompt';

// 启动同步之后给用户看的东西：插件能力不满足时托盘里的状态（#224），待合并更新的对话框（#223）。
// 什么时候显示由启动时的 MPV 配置插件决定（handlers/plugins/mpvConfig.ts）。

// 启动时的能力检查结果；检查本身出错时也当作不满足。只在启动时算一次，托盘每次重建菜单都读它。
let capabilitiesSatisfied = true;

export function setMpvCapabilitiesSatisfied(satisfied: boolean): void {
    capabilitiesSatisfied = satisfied;
}

// 不满足时托盘“设置”子菜单里的一条状态，满足时没有。原因写在日志里。
export function mpvCapabilityTrayItems(): Electron.MenuItemConstructorOptions[] {
    if (capabilitiesSatisfied) return [];
    return [{ label: 'MPV 插件需要更新，片头片尾跳过等功能可能不可用（详见日志）', enabled: false }];
}

// 非模态（不挂在主窗口上），不等它关闭。关闭（任一按钮或右上角）即记为已确认；没关就退出，下次启动再弹。
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
