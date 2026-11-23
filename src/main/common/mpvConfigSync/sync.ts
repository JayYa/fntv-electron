import * as fs from 'node:fs';
import * as path from 'node:path';
import { platformBehavior } from '../../../public/platform';
import {
    type AcknowledgedConflict,
    type InstallRecord,
    type InstalledFile,
    readInstallRecord,
    writeInstallRecord,
} from './installRecord';
import { type FntvManifest, type ManifestFile, type ManifestProblem, readManifest } from './manifest';
import { cleanupLeftoverStaging, PENDING_UPDATE_SUFFIX, removePath, resolveRelative, sha256File, Staging } from './stagedWrites';

export type MpvFileAction =
    | 'unchanged'
    | 'added'
    | 'replaced'
    | 'overwrote-modified'
    | 'wrote-fntv-new'
    | 'kept'
    | 'removed';

export interface MpvFileSyncEntry {
    path: string;
    action: MpvFileAction;
    reason?: string;
}

export interface MpvConfigConflict {
    path: string;
    sha256: string;
}

export type MpvConfigSkipReason = 'same-directory' | ManifestProblem;

export type MpvConfigSyncResult =
    | { status: 'skipped'; reason: MpvConfigSkipReason; detail: string }
    | {
        status: 'synced';
        archiveVersion: string;
        hadInstallRecord: boolean;
        files: MpvFileSyncEntry[];
        conflicts: MpvConfigConflict[];
        provides: Record<string, number>;
        acknowledgedConflicts: AcknowledgedConflict[];
    }
    | { status: 'failed'; error: Error; files: MpvFileSyncEntry[] };

export interface MpvConfigSyncInput {
    portableConfigDir: string;
    manifestPath: string;
    mpvConfigDir: string;
    platform: NodeJS.Platform;
}

function isSameDirectory(existingDir: string, otherDir: string): boolean {
    if (!fs.existsSync(otherDir)) return false;
    return fs.realpathSync.native(existingDir) === fs.realpathSync.native(otherDir);
}

export function synchronizeMpvConfig(input: MpvConfigSyncInput): MpvConfigSyncResult {
    const { portableConfigDir, manifestPath, mpvConfigDir } = input;
    if (!fs.existsSync(portableConfigDir)) {
        return { status: 'failed', error: new Error(`Portable config directory not found: ${portableConfigDir}`), files: [] };
    }
    if (isSameDirectory(portableConfigDir, mpvConfigDir)) {
        return { status: 'skipped', reason: 'same-directory', detail: mpvConfigDir };
    }
    try {
        cleanupLeftoverStaging(mpvConfigDir);
    } catch (error) {
        return { status: 'failed', error: asError(error), files: [] };
    }
    const read = readManifest(manifestPath);
    if (!read.ok) {
        return { status: 'skipped', reason: read.reason, detail: read.detail };
    }

    const run = new SyncRun(input, read.manifest);
    try {
        return run.execute();
    } catch (error) {
        return { status: 'failed', error: asError(error), files: run.entries };
    } finally {
        disposeLeavingStagingForNextStart(run);
    }
}

function disposeLeavingStagingForNextStart(run: SyncRun): boolean {
    try {
        run.dispose();
        return true;
    } catch {
        return false;
    }
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

type FileState = 'unchanged' | 'missing' | 'unmodified' | 'modified';

function overwriteAction(state: FileState): MpvFileAction {
    const actions: Record<FileState, MpvFileAction> = {
        unchanged: 'unchanged',
        missing: 'added',
        unmodified: 'replaced',
        modified: 'overwrote-modified',
    };
    return actions[state];
}

function listFiles(dir: string, prefix: string): string[] {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
    const result: string[] = [];
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const relative = `${prefix}/${item.name}`;
        if (item.isDirectory()) result.push(...listFiles(path.join(dir, item.name), relative));
        else result.push(relative);
    }
    return result;
}

class SyncRun {
    readonly entries: MpvFileSyncEntry[] = [];
    private readonly conflicts: MpvConfigConflict[] = [];
    private readonly installed: Record<string, InstalledFile> = {};
    private readonly obsoleteHashes = new Map<string, string[]>();
    private record: InstallRecord | undefined;
    private staging: Staging | undefined;

    constructor(
        private readonly input: MpvConfigSyncInput,
        private readonly manifest: FntvManifest,
    ) {
        for (const entry of manifest.obsolete) this.obsoleteHashes.set(entry.path, entry.knownHashes);
    }

    private get mpvConfigDir(): string {
        return this.input.mpvConfigDir;
    }

    execute(): MpvConfigSyncResult {
        fs.mkdirSync(this.mpvConfigDir, { recursive: true });
        this.record = readInstallRecord(this.mpvConfigDir);
        this.staging = new Staging(this.mpvConfigDir);

        const managedDirFiles = new Set<string>();
        for (const dir of this.manifest.managedDirs) {
            for (const file of this.syncManagedDir(dir)) managedDirFiles.add(file);
        }
        for (const file of this.manifest.files) {
            if (!managedDirFiles.has(file.path)) this.syncFile(file);
        }
        this.removeDropped();
        this.writeRecord();
        return {
            status: 'synced',
            archiveVersion: this.manifest.archiveVersion,
            hadInstallRecord: this.record !== undefined,
            files: this.entries,
            conflicts: this.conflicts,
            provides: this.manifest.provides,
            acknowledgedConflicts: this.record?.acknowledgedConflicts ?? [],
        };
    }

    dispose(): void {
        this.staging?.dispose();
    }

    private recorded(relative: string): InstalledFile | undefined {
        return this.record?.files[relative];
    }

    private stateOf(current: string | undefined, file: ManifestFile): FileState {
        if (current === file.sha256) return 'unchanged';
        if (current === undefined) return 'missing';
        const recorded = this.recorded(file.path);
        const unmodified = recorded ? current === recorded.sha256 : file.knownHashes.includes(current);
        return unmodified ? 'unmodified' : 'modified';
    }

    private source(relative: string): string {
        return resolveRelative(this.input.portableConfigDir, relative);
    }

    private install(file: ManifestFile, target: string): void {
        const staging = this.staging as Staging;
        staging.place(staging.stageCopy(this.source(file.path), file.sha256), target);
    }

    private syncFile(file: ManifestFile): void {
        const target = resolveRelative(this.mpvConfigDir, file.path);
        const current = sha256File(target);
        const add = (action: MpvFileAction, reason?: string): void => {
            this.entries.push(reason ? { path: file.path, action, reason } : { path: file.path, action });
        };
        const remember = () => {
            if (file.role !== 'seed') this.installed[file.path] = { sha256: file.sha256, role: file.role };
        };

        const state = this.stateOf(current, file);
        if (state === 'unchanged') {
            remember();
            return add('unchanged');
        }
        if (file.role === 'seed' && state !== 'missing') {
            return add('kept', 'seed exists');
        }
        if (file.role === 'managed' || state !== 'modified') {
            this.install(file, target);
            remember();
            return add(overwriteAction(state));
        }
        const newFile = `${target}${PENDING_UPDATE_SUFFIX}`;
        if (this.recorded(file.path)?.sha256 === file.sha256) {
            remember();
            if (sha256File(newFile) === file.sha256) this.conflicts.push({ path: file.path, sha256: file.sha256 });
            return add('kept', 'modified, archive version unchanged since last sync');
        }
        if (file.path === 'mpv.conf' && !this.recorded(file.path)
            && platformBehavior(this.input.platform).treatsUnknownMpvConfAsUserOwned) {
            return add('kept', 'user-owned mpv.conf without install record');
        }
        if (sha256File(newFile) !== file.sha256) this.install(file, newFile);
        this.conflicts.push({ path: file.path, sha256: file.sha256 });
        remember();
        return add('wrote-fntv-new');
    }

    private removable(relative: string, current: string): boolean {
        const recorded = this.recorded(relative);
        if (recorded) return recorded.role !== 'config' && current === recorded.sha256;
        return this.obsoleteHashes.get(relative)?.includes(current) ?? false;
    }

    private syncManagedDir(dir: string): string[] {
        const prefix = `${dir}/`;
        const files = this.manifest.files.filter(file => file.path.startsWith(prefix));
        const listed = new Set(files.map(file => file.path));
        const existing = listFiles(resolveRelative(this.mpvConfigDir, dir), dir);

        let changed = false;
        for (const file of files) {
            const action = overwriteAction(this.stateOf(sha256File(resolveRelative(this.mpvConfigDir, file.path)), file));
            changed ||=action !== 'unchanged';
            this.entries.push({ path: file.path, action });
            this.installed[file.path] = { sha256: file.sha256, role: 'managed' };
        }

        const carried: string[] = [];
        for (const relative of existing.filter(file => !listed.has(file))) {
            const current = sha256File(resolveRelative(this.mpvConfigDir, relative)) as string;
            if (this.removable(relative, current)) {
                this.entries.push({ path: relative, action: 'removed' });
                changed = true;
            } else {
                carried.push(relative);
                if (this.recorded(relative) || this.obsoleteHashes.has(relative)) {
                    this.entries.push({ path: relative, action: 'kept', reason: 'modified, dropped from archive' });
                }
            }
        }

        if (changed) {
            const staging = this.staging as Staging;
            staging.replaceDirectory(dir, fresh => {
                for (const file of files) {
                    staging.stageCopy(this.source(file.path), file.sha256, resolveRelative(fresh, file.path.slice(prefix.length)));
                }
                for (const relative of carried) {
                    staging.stageCarry(resolveRelative(this.mpvConfigDir, relative), resolveRelative(fresh, relative.slice(prefix.length)));
                }
            });
        }
        return files.map(file => file.path);
    }

    private removeDropped(): void {
        const listed = new Set(this.manifest.files.map(file => file.path));
        const inManagedDir = (relative: string) => this.manifest.managedDirs.some(dir => relative.startsWith(`${dir}/`));
        const candidates = new Set([...Object.keys(this.record?.files ?? {}), ...this.obsoleteHashes.keys()]);
        for (const relative of candidates) {
            if (listed.has(relative) || inManagedDir(relative)) continue;
            const target = resolveRelative(this.mpvConfigDir, relative);
            const current = sha256File(target);
            if (current === undefined) continue;
            if (this.recorded(relative)?.role === 'config') {
                this.entries.push({ path: relative, action: 'kept', reason: 'config dropped from archive' });
            } else if (this.removable(relative, current)) {
                removePath(target);
                this.entries.push({ path: relative, action: 'removed' });
            } else {
                this.entries.push({ path: relative, action: 'kept', reason: 'modified, dropped from archive' });
            }
        }
    }

    private writeRecord(): void {
        const record: InstallRecord = {
            archiveVersion: this.manifest.archiveVersion,
            files: this.installed,
            provides: this.manifest.provides,
            acknowledgedConflicts: this.record?.acknowledgedConflicts ?? [],
        };
        writeInstallRecord(this.staging as Staging, this.mpvConfigDir, record);
    }
}
