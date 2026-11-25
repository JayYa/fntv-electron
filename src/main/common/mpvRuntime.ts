import { app, dialog, shell } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as preferences from '../../modules/fn_config/preferences';
import * as logger from '../../modules/logger';
import { checkMpvCapabilities, mpvCapabilityErrorMessage } from './mpvConfigSync/capabilities';
import { acknowledgeConflicts } from './mpvConfigSync/installRecord';
import { mpvConfigSyncLogLines } from './mpvConfigSync/log';
import { resolveManifestPath } from './mpvConfigSync/manifest';
import { type MergePromptText, mergePrompt, mergePromptText } from './mpvConfigSync/mergePrompt';
import { countPendingUpdates, stopWatchingPendingUpdates, watchPendingUpdates } from './mpvConfigSync/pendingUpdates';
import { synchronizeMpvConfig } from './mpvConfigSync/sync';
import { currentPlatform, mpvProgram, mpvUserConfigDir, type UserDirs } from '../../public/platform';

export interface AppPaths {
    appPath: string;
    execPath: string;
    resourcesPath: string;
    isPackaged: boolean;
}

export type MergePromptAnswer = 'openConfigDir' | 'dismissed';

export interface MpvRuntimeDeps {
    platform: NodeJS.Platform;
    env: Record<string, string | undefined>;
    appPaths(): AppPaths;
    userDirs(): UserDirs;
    userMpvPath(): string | undefined;
    askMergePrompt(text: MergePromptText): Promise<MergePromptAnswer>;
    openPath(dir: string): Promise<string>;
}

export interface MpvLaunch {
    path: string;
    bundled: boolean;
    args: string[];
}

export interface MpvUserConfig {
    dir: string;
    pendingUpdates: number;
}

export interface MpvRuntime {
    syncAtStartup(): void;
    program(): MpvLaunch | undefined;
    userConfig(): MpvUserConfig | undefined;
    capabilitiesSatisfied(): boolean;
    onPendingUpdatesChange(listener: () => void): void;
    stop(): void;
}

function archiveDir(baseDir: string): string {
    return path.join(baseDir, 'third_party', 'fntv-mpv');
}

function readTextFileOrNull(target: string): string | null {
    try {
        return fs.readFileSync(target, 'utf8');
    } catch {
        return null;
    }
}

export function createMpvRuntime(deps: MpvRuntimeDeps): MpvRuntime {
    let capabilitiesSatisfied = true;
    const pendingListeners: Array<() => void> = [];

    function configDirFor(userMpvPath: string | undefined): string {
        return mpvUserConfigDir(deps.platform, deps.userDirs(), deps.env, userMpvPath, fs.existsSync, readTextFileOrNull);
    }

    function currentConfigDir(): string | undefined {
        try {
            return configDirFor(deps.userMpvPath());
        } catch (error) {
            logger.error('获取 MPV 用户配置目录失败', error);
            return undefined;
        }
    }

    function bundledMpvPath(): string {
        const paths = deps.appPaths();
        return path.join(archiveDir(paths.isPackaged ? path.dirname(paths.execPath) : paths.appPath), 'mpv.exe');
    }

    function portableConfigDir(): string {
        const paths = deps.appPaths();
        return path.join(archiveDir(paths.isPackaged ? path.dirname(paths.resourcesPath) : paths.appPath), 'portable_config');
    }

    function notifyPendingUpdatesChange(): void {
        for (const listener of pendingListeners) listener();
    }

    return {
        syncAtStartup() {
            try {
                const mpvConfigDir = configDirFor(deps.userMpvPath());
                const portable = portableConfigDir();
                const manifestPath = resolveManifestPath(portable);
                const result = synchronizeMpvConfig({
                    portableConfigDir: portable,
                    manifestPath,
                    mpvConfigDir,
                    platform: deps.platform,
                });
                for (const line of mpvConfigSyncLogLines(result, mpvConfigDir)) {
                    if (line.error) logger[line.level](line.message, line.error);
                    else logger[line.level](line.message);
                }
                const status = checkMpvCapabilities({ syncResult: result, mpvConfigDir, manifestPath });
                capabilitiesSatisfied = status.satisfied;
                if (!status.satisfied) logger.error(mpvCapabilityErrorMessage(status, mpvConfigDir));
                const prompt = mergePrompt(result);
                if (!prompt.show) return;
                const files = prompt.conflicts.map(entry => entry.path).join(', ');
                logger.info(`MPV 配置有待合并的更新，弹出提示${prompt.migration ? '（首次迁移）' : ''}: ${files}`);
                deps.askMergePrompt(mergePromptText(prompt))
                    .then(async answer => {
                        acknowledgeConflicts(mpvConfigDir, prompt.conflicts);
                        logger.info(`MPV 配置待合并更新提示已关闭，记为已确认: ${files}`);
                        if (answer !== 'openConfigDir') return;
                        const error = await deps.openPath(mpvConfigDir);
                        if (error) logger.error(`打开 MPV 用户配置目录失败: ${error}`, mpvConfigDir);
                    })
                    .catch(error => logger.error('MPV 配置待合并更新提示失败:', error));
            } catch (error) {
                capabilitiesSatisfied = false;
                logger.error('初始化 MPV 配置失败:', error);
            }
        },
        program() {
            const program = mpvProgram(deps.platform, deps.userMpvPath(), bundledMpvPath(), fs.existsSync);
            if (!program) return undefined;
            if (!program.bundled) return { ...program, args: [] };
            const mpvConfigDir = currentConfigDir();
            return { ...program, args: mpvConfigDir === undefined ? [] : [`--config-dir=${mpvConfigDir}`] };
        },
        userConfig() {
            const dir = currentConfigDir();
            watchPendingUpdates(dir, notifyPendingUpdatesChange);
            if (dir === undefined) return undefined;
            return { dir, pendingUpdates: countPendingUpdates(dir) };
        },
        capabilitiesSatisfied: () => capabilitiesSatisfied,
        onPendingUpdatesChange(listener) {
            pendingListeners.push(listener);
        },
        stop() {
            stopWatchingPendingUpdates();
        },
    };
}

async function askMergePromptWithDialog(text: MergePromptText): Promise<MergePromptAnswer> {
    const { response } = await dialog.showMessageBox({
        type: 'info',
        ...text,
        buttons: ['打开配置目录', '知道了'],
        defaultId: 1,
        cancelId: 1,
    });
    return response === 0 ? 'openConfigDir' : 'dismissed';
}

export const mpvRuntime = createMpvRuntime({
    platform: currentPlatform(),
    env: process.env,
    appPaths: () => ({
        appPath: app.getAppPath(),
        execPath: process.execPath,
        resourcesPath: process.resourcesPath,
        isPackaged: app.isPackaged,
    }),
    userDirs: () => ({ homeDir: os.homedir(), appDataDir: app.getPath('appData') }),
    userMpvPath: () => preferences.get('userMpvPath'),
    askMergePrompt: askMergePromptWithDialog,
    openPath: target => shell.openPath(target),
});
