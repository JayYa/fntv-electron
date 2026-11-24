import type { BrowserWindow } from 'electron';
import type { DownloadProgress } from '../../modules/updater/inAppUpdate';

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
