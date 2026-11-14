import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ManifestFileRole } from './manifest';

// 安装记录：用户配置目录下的 fntv/installed.json，只在同步全部完成后写。
// 换目标目录时自然换一份记录（#219 用户故事 27）。

export const INSTALL_RECORD_PATH = 'fntv/installed.json';

export interface InstalledFile {
    /** 上次同步装入（或认定为新版）的哈希，用来判断用户有没有改过。 */
    sha256: string;
    role: ManifestFileRole;
}

/** 用户已确认、不再提示的冲突：路径加 `.fntv-new` 的新版哈希。 */
export interface AcknowledgedConflict {
    path: string;
    sha256: string;
}

export interface InstallRecord {
    archiveVersion: string;
    files: Record<string, InstalledFile>;
    provides: Record<string, number>;
    acknowledgedConflicts: AcknowledgedConflict[];
}

export function installRecordFile(mpvConfigDir: string): string {
    return path.join(mpvConfigDir, ...INSTALL_RECORD_PATH.split('/'));
}

/** 读不到或内容坏了都当成没有记录：最坏情况是按历史哈希判断，多一次 `.fntv-new`。 */
export function readInstallRecord(mpvConfigDir: string): InstallRecord | undefined {
    let data: unknown;
    try {
        data = JSON.parse(fs.readFileSync(installRecordFile(mpvConfigDir), 'utf8'));
    } catch {
        return undefined;
    }
    if (typeof data !== 'object' || data === null) return undefined;
    const record = data as Partial<InstallRecord>;
    if (typeof record.archiveVersion !== 'string' || typeof record.files !== 'object' || record.files === null) {
        return undefined;
    }
    return {
        archiveVersion: record.archiveVersion,
        files: record.files,
        provides: typeof record.provides === 'object' && record.provides !== null ? record.provides : {},
        acknowledgedConflicts: Array.isArray(record.acknowledgedConflicts) ? record.acknowledgedConflicts : [],
    };
}
