import * as fs from 'node:fs';
import * as path from 'node:path';
import { STAGING_PREFIX } from './stagedWrites';

// 用户配置里还在的待合并更新（`<文件>.fntv-new`），托盘“设置”子菜单显示它们的个数（#223）。

const PENDING_SUFFIX = '.fntv-new';
const REFRESH_DELAY_MS = 200;

export function countPendingUpdates(mpvConfigDir: string): number {
    let count = 0;
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(mpvConfigDir, { withFileTypes: true });
    } catch {
        return 0;
    }
    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (!entry.name.startsWith(STAGING_PREFIX)) count += countPendingUpdates(path.join(mpvConfigDir, entry.name));
        } else if (entry.isFile() && entry.name.endsWith(PENDING_SUFFIX)) {
            count += 1;
        }
    }
    return count;
}

let watched: { dir: string; watcher: fs.FSWatcher; timer?: NodeJS.Timeout } | undefined;

/**
 * 监视用户配置目录，`.fntv-new` 增删时（去抖后）调 onChange，让托盘菜单重算个数。
 * 目录变了就改监视新目录；目录不存在或监视失败时不监视，菜单下次重建时照样重算。
 */
export function watchPendingUpdates(mpvConfigDir: string | undefined, onChange: () => void): void {
    if (watched?.dir === mpvConfigDir) return;
    stopWatchingPendingUpdates();
    if (mpvConfigDir === undefined || !fs.existsSync(mpvConfigDir)) return;
    try {
        const current: NonNullable<typeof watched> = {
            dir: mpvConfigDir,
            watcher: fs.watch(mpvConfigDir, { recursive: true }, (_event, filename) => {
                if (filename && !filename.toString().endsWith(PENDING_SUFFIX)) return;
                clearTimeout(current.timer);
                current.timer = setTimeout(onChange, REFRESH_DELAY_MS);
            }),
        };
        // 目录被删等错误：停止监视，不影响托盘。
        current.watcher.on('error', () => stopWatchingPendingUpdates());
        current.watcher.unref();
        watched = current;
    } catch {
        // 平台不支持递归监视等：只在菜单重建时重算。
    }
}

export function stopWatchingPendingUpdates(): void {
    if (!watched) return;
    clearTimeout(watched.timer);
    watched.watcher.close();
    watched = undefined;
}
