import { readInstallRecord } from './installRecord';
import { MANIFEST_PROBLEM_TEXT, type ManifestProblem, readManifest } from './manifest';
import type { MpvConfigSyncResult } from './sync';

// 客户端依赖的插件能力（docs/mpv-archive-contract.md“能力”一节）。不依赖 Electron：
// 启动时检查用户配置（#224）和构建期检查固定归档的清单（#221）共用 unmetCapabilities 与 describeUnmetCapability。

/** 能力名 -> 客户端要求的最低版本。插件和客户端的约定变了时，和归档清单的 provides 一起改。 */
export const MPV_REQUIRED_CAPABILITIES: Readonly<Record<string, number>> = {
    // smart_skip 从播放地址取 Proxy 的 scheme、主机和端口（#167）。
    'smart-skip.origin-from-play-url': 1,
};

export interface UnmetCapability {
    name: string;
    required: number;
    /** 提供了但版本过低时是提供的版本；完全没提供时省略。 */
    provided?: number;
}

/** provides 里不满足 MPV_REQUIRED_CAPABILITIES 的能力。 */
export function unmetCapabilities(provides: Readonly<Record<string, number>>): UnmetCapability[] {
    const unmet: UnmetCapability[] = [];
    for (const [name, required] of Object.entries(MPV_REQUIRED_CAPABILITIES)) {
        const provided = Object.hasOwn(provides, name) ? provides[name] : undefined;
        if (provided === undefined) unmet.push({ name, required });
        else if (provided < required) unmet.push({ name, required, provided });
    }
    return unmet;
}

/**
 * 一个不满足的能力写进日志或构建输出的样子：能力名、要求的版本、实际提供的版本。
 * 能力名后紧跟 ASCII 逗号：日志脱敏把 `url` 后面的一段当成地址遮掉（maskingConfig 的 url 规则），
 * smart-skip.origin-from-play-url 以 url 结尾，后面接空格或括号都会被遮。
 */
export function describeUnmetCapability({ name, required, provided }: UnmetCapability): string {
    return `${name}, 需要 ${required}, ${provided === undefined ? '未提供' : `当前 ${provided}`}`;
}

/** provides 从哪里读：平时是用户配置的安装记录；用户配置就是便携配置时没有安装记录，读归档清单。 */
export type CapabilitySource = 'install-record' | 'manifest';

export type MpvCapabilityStatus =
    | { satisfied: true; source: CapabilitySource }
    | {
        satisfied: false;
        source: CapabilitySource;
        /** 读不到 provides 的原因；读到了只是不满足时省略。 */
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
        // 本次同步失败时，旧的安装记录仍描述用户配置里实际装着的插件。
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

/** 不满足时写进日志的 ERROR 文本：列出每个缺的能力、要求的版本和实际提供的版本。 */
export function mpvCapabilityErrorMessage(
    status: Extract<MpvCapabilityStatus, { satisfied: false }>,
    mpvConfigDir: string,
): string {
    const items = status.missing.map(describeUnmetCapability).join('；');
    const from = status.source === 'manifest' ? '归档清单' : '安装记录';
    const why = status.reason ? `${REASON_TEXT[status.reason]}；` : '';
    return `MPV 插件不满足客户端要求的能力，相关功能可能不可用: ${why}${items}；按${from}检查: ${mpvConfigDir}`;
}
