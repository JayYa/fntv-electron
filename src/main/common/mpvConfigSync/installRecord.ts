import * as fs from 'node:fs';
import type { ManifestFileRole } from './manifest';
import { resolveRelative, Staging } from './stagedWrites';

export const INSTALL_RECORD_PATH = 'fntv/installed.json';

export interface InstalledFile {
    sha256: string;
    role: ManifestFileRole;
}

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
    return resolveRelative(mpvConfigDir, INSTALL_RECORD_PATH);
}

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

export function writeInstallRecord(staging: Staging, mpvConfigDir: string, record: InstallRecord): void {
    staging.place(staging.stageText(`${JSON.stringify(record, null, 2)}\n`), installRecordFile(mpvConfigDir));
}

export function acknowledgeConflicts(mpvConfigDir: string, conflicts: AcknowledgedConflict[]): void {
    const record = readInstallRecord(mpvConfigDir);
    if (!record) return;
    const paths = new Set(conflicts.map(entry => entry.path));
    const acknowledgedConflicts = [
        ...record.acknowledgedConflicts.filter(entry => !paths.has(entry.path)),
        ...conflicts.map(({ path: file, sha256 }) => ({ path: file, sha256 })),
    ];
    const staging = new Staging(mpvConfigDir);
    try {
        writeInstallRecord(staging, mpvConfigDir, { ...record, acknowledgedConflicts });
    } finally {
        staging.dispose();
    }
}
