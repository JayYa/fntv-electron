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
import { cleanupLeftoverStaging, nodeFileOps, sha256File, Staging, type SyncFileOps } from './stagedWrites';

// 按清单把便携配置同步到用户配置（规则见 docs/external-runtime.md“用户配置同步”和 spec #219）。

export type MpvFileAction =
    /** 当前内容已等于新版，不动。 */
    | 'unchanged'
    /** 缺失，补上。 */
    | 'added'
    /** 用户没改过，换成新版。 */
    | 'replaced'
    /** 托管文件被用户改过，照样覆盖，不备份。 */
    | 'overwrote-modified'
    /** 用户改过的配置，原文件不动，新版写到 `<文件>.fntv-new`。 */
    | 'wrote-fntv-new'
    /** 保留用户的文件，原因见 reason。 */
    | 'kept'
    /** 归档删掉的托管文件，用户没改过，删除。 */
    | 'removed';

export interface MpvFileSyncEntry {
    /** 相对用户配置，正斜杠。 */
    path: string;
    action: MpvFileAction;
    reason?: string;
}

/**
 * 待合并的冲突：本次写了 `.fntv-new`，或上次写的 `.fntv-new` 还在。sha256 是新版（`.fntv-new` 内容）的哈希，
 * 确认冲突时连同路径记下。
 */
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
        /** 同步前用户配置里有没有安装记录。没有时是首次迁移（或全新安装）。 */
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
    /** 只在测试里替换。 */
    fileOps?: SyncFileOps;
}

// realpath 消掉 `..`、尾部分隔符、符号链接，Windows 上还统一大小写。不存在的目录不可能是已存在的来源。
function isSameDirectory(existingDir: string, otherDir: string): boolean {
    if (!fs.existsSync(otherDir)) return false;
    return fs.realpathSync.native(existingDir) === fs.realpathSync.native(otherDir);
}

export function synchronizeMpvConfig(input: MpvConfigSyncInput): MpvConfigSyncResult {
    const { portableConfigDir, manifestPath, mpvConfigDir } = input;
    if (!fs.existsSync(portableConfigDir)) {
        return { status: 'failed', error: new Error(`Portable config directory not found: ${portableConfigDir}`), files: [] };
    }
    // 用户配置就是便携配置时，同步从没往这里写过，没有要清理的暂存目录。
    if (isSameDirectory(portableConfigDir, mpvConfigDir)) {
        return { status: 'skipped', reason: 'same-directory', detail: mpvConfigDir };
    }
    const ops = input.fileOps ?? nodeFileOps;
    // 读清单之前清理：清单缺失或版本不认识时不同步，但上次中途退出时移开的插件目录要放回去。
    try {
        cleanupLeftoverStaging(mpvConfigDir, ops);
    } catch (error) {
        return { status: 'failed', error: asError(error), files: [] };
    }
    const read = readManifest(manifestPath);
    if (!read.ok) {
        return { status: 'skipped', reason: read.reason, detail: read.detail };
    }

    const run = new SyncRun(input, read.manifest, ops);
    try {
        return run.execute();
    } catch (error) {
        return { status: 'failed', error: asError(error), files: run.entries };
    } finally {
        try {
            run.dispose();
        } catch {
            // 删不掉本次的暂存目录不影响结果：下次启动先清理残留的暂存目录。
        }
    }
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

function toFsPath(root: string, relative: string): string {
    return path.join(root, ...relative.split('/'));
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
        private readonly ops: SyncFileOps,
    ) {
        for (const entry of manifest.obsolete) this.obsoleteHashes.set(entry.path, entry.knownHashes);
    }

    private get user(): string {
        return this.input.mpvConfigDir;
    }

    execute(): MpvConfigSyncResult {
        this.ops.mkdir(this.user);
        this.record = readInstallRecord(this.user);
        this.staging = new Staging(this.user, this.ops);

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

    // 有记录看是否等于记录值；没有记录看是否在历史哈希里。
    private isUnmodified(current: string, file: ManifestFile): boolean {
        const recorded = this.recorded(file.path);
        return recorded ? current === recorded.sha256 : file.knownHashes.includes(current);
    }

    private source(relative: string): string {
        return toFsPath(this.input.portableConfigDir, relative);
    }

    private install(file: ManifestFile, target: string): void {
        const staging = this.staging as Staging;
        staging.place(staging.stageCopy(this.source(file.path), file.sha256), target);
    }

    private syncFile(file: ManifestFile): void {
        const target = toFsPath(this.user, file.path);
        const current = sha256File(target);
        const add = (action: MpvFileAction, reason?: string): void => {
            this.entries.push(reason ? { path: file.path, action, reason } : { path: file.path, action });
        };
        const remember = () => {
            if (file.role !== 'seed') this.installed[file.path] = { sha256: file.sha256, role: file.role };
        };

        if (current === file.sha256) {
            remember();
            return add('unchanged');
        }
        if (current === undefined) {
            this.install(file, target);
            remember();
            return add('added');
        }
        if (file.role === 'seed') {
            return add('kept', 'seed exists');
        }
        const unmodified = this.isUnmodified(current, file);
        if (unmodified || file.role === 'managed') {
            this.install(file, target);
            remember();
            return add(unmodified ? 'replaced' : 'overwrote-modified');
        }
        // config，用户改过。
        const newFile = `${target}.fntv-new`;
        if (this.recorded(file.path)?.sha256 === file.sha256) {
            remember();
            // 上次写的 .fntv-new 还在：仍是待合并的冲突，提示没关掉就退出时下次启动再弹（#223）。
            if (sha256File(newFile) === file.sha256) this.conflicts.push({ path: file.path, sha256: file.sha256 });
            return add('kept', 'modified, archive version unchanged since last sync');
        }
        if (file.path === 'mpv.conf' && !this.recorded(file.path)
            && platformBehavior(this.input.platform).treatsUnknownMpvConfAsUserOwned) {
            // 不记录：下次仍按“没有记录”判断，系统 MPV 用户的 mpv.conf 一直归用户。
            return add('kept', 'user-owned mpv.conf without install record');
        }
        if (sha256File(newFile) !== file.sha256) this.install(file, newFile);
        this.conflicts.push({ path: file.path, sha256: file.sha256 });
        remember();
        return add('wrote-fntv-new');
    }

    // 记录里有、新清单没有的文件，或清单 obsolete 里的文件，是否可以删（哈希等于记录值；没有记录时按 obsolete）。
    private removable(relative: string, current: string): boolean {
        const recorded = this.recorded(relative);
        if (recorded) return recorded.role !== 'config' && current === recorded.sha256;
        return this.obsoleteHashes.get(relative)?.includes(current) ?? false;
    }

    // 返回这个目录下清单列出的文件。
    private syncManagedDir(dir: string): string[] {
        const prefix = `${dir}/`;
        const files = this.manifest.files.filter(file => file.path.startsWith(prefix));
        const listed = new Set(files.map(file => file.path));
        const existing = listFiles(toFsPath(this.user, dir), dir);

        let changed = false;
        for (const file of files) {
            const current = sha256File(toFsPath(this.user, file.path));
            let action: MpvFileAction;
            if (current === file.sha256) action = 'unchanged';
            else if (current === undefined) action = 'added';
            else action = this.isUnmodified(current, file) ? 'replaced' : 'overwrote-modified';
            changed ||= action !== 'unchanged';
            this.entries.push({ path: file.path, action });
            this.installed[file.path] = { sha256: file.sha256, role: 'managed' };
        }

        const carried: string[] = [];
        for (const relative of existing.filter(file => !listed.has(file))) {
            const current = sha256File(toFsPath(this.user, relative)) as string;
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
                    staging.stageCopy(this.source(file.path), file.sha256, toFsPath(fresh, file.path.slice(prefix.length)));
                }
                for (const relative of carried) {
                    staging.stageCarry(toFsPath(this.user, relative), toFsPath(fresh, relative.slice(prefix.length)));
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
            const target = toFsPath(this.user, relative);
            const current = sha256File(target);
            if (current === undefined) continue;
            if (this.recorded(relative)?.role === 'config') {
                this.entries.push({ path: relative, action: 'kept', reason: 'config dropped from archive' });
            } else if (this.removable(relative, current)) {
                this.ops.remove(target);
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
        writeInstallRecord(this.staging as Staging, this.user, record);
    }
}
