import { MANIFEST_PROBLEM_TEXT } from './manifest';
import type { MpvConfigSyncResult, MpvFileAction } from './sync';

// 同步结果写进日志的样子：按文件列出动作，未变的文件只计数（#219 用户故事 34）。

export interface MpvConfigSyncLogLine {
    level: 'info' | 'warn' | 'error';
    message: string;
    error?: Error;
}

const ACTION_LABELS: Record<Exclude<MpvFileAction, 'unchanged'>, string> = {
    added: '补上',
    replaced: '换新',
    'overwrote-modified': '托管文件被用户改过，已覆盖',
    'wrote-fntv-new': '用户改过，新版写到 .fntv-new',
    kept: '保留',
    removed: '删除',
};

export function mpvConfigSyncLogLines(result: MpvConfigSyncResult, mpvConfigDir: string): MpvConfigSyncLogLine[] {
    if (result.status === 'skipped') {
        if (result.reason === 'same-directory') {
            // 自选 mpv 就是附带的 mpv：它读的就是来源目录，改了会随安装包升级被覆盖。
            return [{ level: 'warn', message: `MPV 配置目录就是便携配置，跳过同步: ${mpvConfigDir}` }];
        }
        return [{ level: 'error', message: `${MANIFEST_PROBLEM_TEXT[result.reason]}，跳过同步，用户配置未改动: ${result.detail}` }];
    }

    const fileLines: MpvConfigSyncLogLine[] = result.files
        .filter(entry => entry.action !== 'unchanged')
        .map(entry => ({
            level: 'info',
            message: `  ${ACTION_LABELS[entry.action as Exclude<MpvFileAction, 'unchanged'>]}: ${entry.path}${entry.reason ? `（${entry.reason}）` : ''}`,
        }));

    if (result.status === 'failed') {
        return [
            { level: 'error', message: `MPV 配置同步失败，已到位的文件保留，下次启动重试: ${mpvConfigDir}`, error: result.error },
            ...fileLines,
        ];
    }

    const unchanged = result.files.length - fileLines.length;
    return [
        {
            level: 'info',
            message: `MPV 配置已按清单 ${result.archiveVersion} 同步: ${mpvConfigDir}（${unchanged} 个文件未变，`
                + `${result.conflicts.length} 个待合并${result.hadInstallRecord ? '' : '，没有安装记录'}）`,
        },
        ...fileLines,
    ];
}
