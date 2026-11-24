import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as settings from '../../../modules/fn_config/settings';
import * as logger from '../../../modules/logger';
import { resolveBundledMpvPath, resolvePortableConfigDir } from '../../common/mpvConfigHelpers';
import { setMpvCapabilitiesSatisfied, showMergePrompt } from '../../common/mpvConfigNotices';
import {
    checkMpvCapabilities,
    type MpvCapabilityCheckInput,
    mpvCapabilityErrorMessage,
} from '../../common/mpvConfigSync/capabilities';
import { mpvConfigSyncLogLines } from '../../common/mpvConfigSync/log';
import { mergePrompt } from '../../common/mpvConfigSync/mergePrompt';
import { resolveManifestPath } from '../../common/mpvConfigSync/manifest';
import { synchronizeMpvConfig } from '../../common/mpvConfigSync/sync';
import { currentPlatform, mpvProgram, MpvProgram, mpvUserConfigDir } from '../../../public/platform';

export function getMpvConfigDir(userMpvPath?: string): string {
    return mpvUserConfigDir(
        currentPlatform(),
        { homeDir: os.homedir(), appDataDir: app.getPath('appData') },
        process.env,
        userMpvPath,
        fs.existsSync,
        readTextFileOrNull,
    );
}

function readTextFileOrNull(target: string): string | null {
    try {
        return fs.readFileSync(target, 'utf8');
    } catch {
        return null;
    }
}

export function getCurrentMpvProgram(): MpvProgram | undefined {
    const bundledMpvPath = resolveBundledMpvPath({
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged,
    });
    return mpvProgram(currentPlatform(), settings.getMpvPlayerPath(), bundledMpvPath, fs.existsSync);
}

function getPortableConfigDir(): string {
    return resolvePortableConfigDir({
        appPath: app.getAppPath(),
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
    });
}

function checkCapabilities(input: MpvCapabilityCheckInput): void {
    const status = checkMpvCapabilities(input);
    setMpvCapabilitiesSatisfied(status.satisfied);
    if (!status.satisfied) logger.error(mpvCapabilityErrorMessage(status, input.mpvConfigDir));
}

function initializeMpvConfig(): void {
    try {
        const mpvConfigDir = getMpvConfigDir(settings.getMpvPlayerPath());
        const portableConfigDir = getPortableConfigDir();
        const manifestPath = resolveManifestPath(portableConfigDir);
        const result = synchronizeMpvConfig({
            portableConfigDir,
            manifestPath,
            mpvConfigDir,
            platform: currentPlatform(),
        });
        for (const line of mpvConfigSyncLogLines(result, mpvConfigDir)) {
            if (line.error) logger[line.level](line.message, line.error);
            else logger[line.level](line.message);
        }
        checkCapabilities({ syncResult: result, mpvConfigDir, manifestPath });
        const prompt = mergePrompt(result);
        if (prompt.show) showMergePrompt(prompt, mpvConfigDir);
    } catch (error) {
        setMpvCapabilitiesSatisfied(false);
        logger.error('初始化 MPV 配置失败:', error);
    }
}

function init(): void {
    logger.info('Initializing MPV Config Plugin...');
    initializeMpvConfig();
}

export {
    init
};
