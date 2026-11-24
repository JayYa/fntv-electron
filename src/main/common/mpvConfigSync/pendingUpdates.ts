import * as fs from 'node:fs';
import * as path from 'node:path';
import { PENDING_UPDATE_SUFFIX, STAGING_PREFIX } from './stagedWrites';

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
        } else if (entry.isFile() && entry.name.endsWith(PENDING_UPDATE_SUFFIX)) {
            count += 1;
        }
    }
    return count;
}

let watched: { dir: string; watcher: fs.FSWatcher; timer?: NodeJS.Timeout } | undefined;

export function watchPendingUpdates(mpvConfigDir: string | undefined, onChange: () => void): void {
    if (watched?.dir === mpvConfigDir) return;
    stopWatchingPendingUpdates();
    if (mpvConfigDir === undefined || !fs.existsSync(mpvConfigDir)) return;
    const current: { dir: string; timer?: NodeJS.Timeout } = { dir: mpvConfigDir };
    const scheduleRefresh = () => {
        clearTimeout(current.timer);
        current.timer = setTimeout(onChange, REFRESH_DELAY_MS);
    };
    const watcher = tryWatchRecursive(mpvConfigDir, (_event, filename) => {
        if (filename && !filename.toString().endsWith(PENDING_UPDATE_SUFFIX)) return;
        scheduleRefresh();
    });
    if (!watcher) return;
    watcher.on('error', () => stopWatchingPendingUpdates());
    watcher.unref();
    watched = Object.assign(current, { watcher });
    scheduleRefresh();
}

function tryWatchRecursive(dir: string, listener: fs.WatchListener<string>): fs.FSWatcher | undefined {
    try {
        return fs.watch(dir, { recursive: true }, listener);
    } catch {
        return undefined;
    }
}

export function stopWatchingPendingUpdates(): void {
    if (!watched) return;
    clearTimeout(watched.timer);
    watched.watcher.close();
    watched = undefined;
}
