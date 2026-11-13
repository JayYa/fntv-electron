import type { BrowserWindow } from 'electron';
import type { DownloadProgress } from '../../modules/updater/inAppUpdate';

/**
 * 应用内更新下载中，窗口的任务栏图标显示下载进度条，下载结束时去掉。
 * 窗口销毁后不再更新。
 */
export function bindTaskbarProgress(
    window: Pick<BrowserWindow, 'isDestroyed' | 'setProgressBar'>,
    progress: DownloadProgress
): void {
    progress.onChange(percent => {
        if (!window.isDestroyed()) {
            window.setProgressBar(percent === null ? -1 : percent / 100);
        }
    });
}
