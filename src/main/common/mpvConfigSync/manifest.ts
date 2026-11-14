import * as fs from 'node:fs';
import * as path from 'node:path';

// MPV 归档根目录里的清单，形状是和 fntv-mpv-config 的契约（spec #219“清单”一节）。

/** 客户端认识的清单格式版本。不在其中的清单一律不用来同步。 */
export const SUPPORTED_MANIFEST_FORMAT_VERSIONS: readonly number[] = [1];

export const MANIFEST_FILE_NAME = 'fntv-manifest.json';

export type ManifestFileRole = 'managed' | 'config' | 'seed';

export interface ManifestFile {
    /** 相对便携配置，正斜杠。 */
    path: string;
    sha256: string;
    role: ManifestFileRole;
    /** 这个路径在历史归档里出现过的全部哈希，含本次。 */
    knownHashes: string[];
}

export interface FntvManifest {
    formatVersion: number;
    archiveVersion: string;
    mpvMinVersion?: string;
    components: Record<string, string>;
    provides: Record<string, number>;
    managedDirs: string[];
    files: ManifestFile[];
    obsolete: Array<{ path: string; knownHashes: string[] }>;
}

export type ManifestProblem = 'manifest-missing' | 'manifest-unsupported' | 'manifest-invalid';

/** 清单问题写进日志的说法：同步跳过和能力检查共用。 */
export const MANIFEST_PROBLEM_TEXT: Readonly<Record<ManifestProblem, string>> = {
    'manifest-missing': 'MPV 归档清单缺失',
    'manifest-unsupported': 'MPV 归档清单格式版本不受支持',
    'manifest-invalid': 'MPV 归档清单无效',
};

export type ManifestReadResult =
    | { ok: true; manifest: FntvManifest }
    | { ok: false; reason: ManifestProblem; detail: string };

/** 清单在归档根目录，也就是便携配置的上一级（`third_party/fntv-mpv/fntv-manifest.json`）。 */
export function resolveManifestPath(portableConfigDir: string): string {
    return path.join(path.dirname(portableConfigDir), MANIFEST_FILE_NAME);
}

export function readManifest(manifestPath: string): ManifestReadResult {
    let text: string;
    try {
        text = fs.readFileSync(manifestPath, 'utf8');
    } catch (error) {
        return { ok: false, reason: 'manifest-missing', detail: `${manifestPath}: ${String(error)}` };
    }
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch (error) {
        return { ok: false, reason: 'manifest-invalid', detail: `${manifestPath}: ${String(error)}` };
    }
    if (!isRecord(data)) {
        return { ok: false, reason: 'manifest-invalid', detail: `${manifestPath}: not an object` };
    }
    if (typeof data.formatVersion !== 'number' || !SUPPORTED_MANIFEST_FORMAT_VERSIONS.includes(data.formatVersion)) {
        return {
            ok: false,
            reason: 'manifest-unsupported',
            detail: `${manifestPath}: formatVersion ${JSON.stringify(data.formatVersion)}, supported ${SUPPORTED_MANIFEST_FORMAT_VERSIONS.join(', ')}`,
        };
    }
    const problem = shapeProblem(data);
    if (problem) {
        return { ok: false, reason: 'manifest-invalid', detail: `${manifestPath}: ${problem}` };
    }
    return { ok: true, manifest: data as unknown as FntvManifest };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SHA256 = /^[0-9a-f]{64}$/;
const ROLES: readonly string[] = ['managed', 'config', 'seed'];

// 只接受便携配置内部的相对路径：清单说了算写哪里，不能让它指到用户配置外面。
function isSafeRelativePath(value: unknown): value is string {
    if (typeof value !== 'string' || value === '' || value.includes('\\') || value.startsWith('/')) {
        return false;
    }
    return value.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..' && !segment.includes(':'));
}

function isHashList(value: unknown): boolean {
    return Array.isArray(value) && value.every(hash => typeof hash === 'string' && SHA256.test(hash));
}

function shapeProblem(data: Record<string, unknown>): string | undefined {
    if (typeof data.archiveVersion !== 'string') return 'archiveVersion is not a string';
    if (!isRecord(data.provides) || !Object.values(data.provides).every(v => typeof v === 'number')) {
        return 'provides is not a map of numbers';
    }
    if (!Array.isArray(data.managedDirs) || !data.managedDirs.every(isSafeRelativePath)) {
        return 'managedDirs is not a list of relative paths';
    }
    if (!Array.isArray(data.files)) return 'files is not a list';
    const seen = new Set<string>();
    for (const file of data.files as unknown[]) {
        if (!isRecord(file) || !isSafeRelativePath(file.path)) return `bad file entry ${JSON.stringify(file)}`;
        if (seen.has(file.path)) return `duplicate file ${file.path}`;
        seen.add(file.path);
        if (typeof file.sha256 !== 'string' || !SHA256.test(file.sha256)) return `bad sha256 for ${file.path}`;
        if (typeof file.role !== 'string' || !ROLES.includes(file.role)) return `bad role for ${file.path}`;
        if (!isHashList(file.knownHashes)) return `bad knownHashes for ${file.path}`;
    }
    if (!Array.isArray(data.obsolete)) return 'obsolete is not a list';
    for (const entry of data.obsolete as unknown[]) {
        if (!isRecord(entry) || !isSafeRelativePath(entry.path) || !isHashList(entry.knownHashes)) {
            return `bad obsolete entry ${JSON.stringify(entry)}`;
        }
    }
    return undefined;
}
