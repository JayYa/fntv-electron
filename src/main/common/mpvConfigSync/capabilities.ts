import { readInstallRecord } from './installRecord';
import { MANIFEST_PROBLEM_TEXT, type ManifestProblem, readManifest } from './manifest';
import type { MpvConfigSyncResult } from './sync';

export const MPV_REQUIRED_CAPABILITIES: Readonly<Record<string, number>> = {
    'smart-skip.origin-from-play-url': 1,
};

export interface UnmetCapability {
    name: string;
    required: number;
    provided?: number;
}

export function unmetCapabilities(provides: Readonly<Record<string, number>>): UnmetCapability[] {
    const unmet: UnmetCapability[] = [];
    for (const [name, required] of Object.entries(MPV_REQUIRED_CAPABILITIES)) {
        const provided = Object.hasOwn(provides, name) ? provides[name] : undefined;
        if (provided === undefined) unmet.push({ name, required });
        else if (provided < required) unmet.push({ name, required, provided });
    }
    return unmet;
}

export function describeUnmetCapability({ name, required, provided }: UnmetCapability): string {
    return `${name}, 需要 ${required}, ${provided === undefined ? '未提供' : `当前 ${provided}`}`;
}

export type CapabilitySource = 'install-record' | 'manifest';

export type MpvCapabilityStatus =
    | { satisfied: true; source: CapabilitySource }
    | {
        satisfied: false;
        source: CapabilitySource;
        reason?: 'no-install-record' | ManifestProblem;
        missing: UnmetCapability[];
    };

export interface MpvCapabilityCheckInput {
    syncResult: MpvConfigSyncResult;
    mpvConfigDir: string;
    manifestPath: string;
}

export function checkMpvCapabilities(input: MpvCapabilityCheckInput): MpvCapabilityStatus {
    const sameDirectory = input.syncResult.status === 'skipped' && input.syncResult.reason === 'same-directory';
    const source: CapabilitySource = sameDirectory ? 'manifest' : 'install-record';
    let provides: Record<string, number> | undefined;
    let reason: 'no-install-record' | ManifestProblem | undefined;
    if (sameDirectory) {
        const read = readManifest(input.manifestPath);
        if (read.ok) provides = read.manifest.provides;
        else reason = read.reason;
    } else {
        provides = readInstallRecord(input.mpvConfigDir)?.provides;
        if (!provides) reason = 'no-install-record';
    }
    const missing = unmetCapabilities(provides ?? {});
    if (missing.length === 0) return { satisfied: true, source };
    return reason ? { satisfied: false, source, reason, missing } : { satisfied: false, source, missing };
}

const REASON_TEXT: Record<'no-install-record' | ManifestProblem, string> = {
    'no-install-record': '用户配置没有安装记录（同步从未成功）',
    ...MANIFEST_PROBLEM_TEXT,
};

export function mpvCapabilityErrorMessage(
    status: Extract<MpvCapabilityStatus, { satisfied: false }>,
    mpvConfigDir: string,
): string {
    const items = status.missing.map(describeUnmetCapability).join('；');
    const from = status.source === 'manifest' ? '归档清单' : '安装记录';
    const why = status.reason ? `${REASON_TEXT[status.reason]}；` : '';
    return `MPV 插件不满足客户端要求的能力，相关功能可能不可用: ${why}${items}；按${from}检查: ${mpvConfigDir}`;
}
