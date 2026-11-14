import type { MpvConfigConflict, MpvConfigSyncResult } from './sync';

// 待合并更新的提示（#223）：同步结果里还没确认过的冲突弹一次，关掉即记为已确认（安装记录 acknowledgedConflicts）。
// 同一文件的新版哈希变了算新冲突，重新提示。

export interface MergePrompt {
    show: boolean;
    /** 要列出、关闭后要记为已确认的冲突。 */
    conflicts: MpvConfigConflict[];
    /** 没有安装记录时发现的冲突：一次性迁移的文案。 */
    migration: boolean;
}

export function mergePrompt(result: MpvConfigSyncResult): MergePrompt {
    if (result.status !== 'synced') return { show: false, conflicts: [], migration: false };
    const acknowledged = new Set(result.acknowledgedConflicts.map(entry => `${entry.path}\n${entry.sha256}`));
    const conflicts = result.conflicts.filter(entry => !acknowledged.has(`${entry.path}\n${entry.sha256}`));
    return { show: conflicts.length > 0, conflicts, migration: conflicts.length > 0 && !result.hadInstallRecord };
}

export interface MergePromptText {
    title: string;
    message: string;
    detail: string;
}

export function mergePromptText(prompt: MergePrompt): MergePromptText {
    const list = prompt.conflicts.map(entry => `  ${entry.path}.fntv-new`).join('\n');
    const howTo = '合并方法：把你自己的改动搬到 .fntv-new 里，再用它替换原文件；'
        + '或者保留你自己的文件，删掉 .fntv-new。删掉或合并完后托盘里的提示会消失。';
    const intro = prompt.migration
        ? '这是一次性迁移：客户端改为按文件判断MPV配置有没有被改过。下面这些文件和本客户端发过的任何版本都不一样，'
            + '所以原文件没动，新版放在旁边的 .fntv-new 里。以后只有新版改到你改过的文件时才会再提示。'
        : '这些文件你改过，原文件没动，新版放在旁边的 .fntv-new 里。';
    return {
        title: 'MPV配置有待合并的更新',
        message: `MPV配置有 ${prompt.conflicts.length} 个待合并的更新`,
        detail: `${intro}\n\n${list}\n\n${howTo}`,
    };
}
