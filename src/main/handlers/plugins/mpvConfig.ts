import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as fnConfig from '../../../modules/fn_config/config';
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
import { currentPlatform, mpvPlayer, MpvPlayer, mpvUserConfigDir } from '../../../public/platform';

/**
 * MPV 配置文件管理插件
 * 启动时按 MPV 归档清单把便携配置同步到用户配置（src/main/common/mpvConfigSync），
 * 再检查插件能力、决定要不要提示待合并更新；托盘状态和对话框在 src/main/common/mpvConfigNotices.ts。
 */

// 获取用户MPV 配置目录。附带 MPV 用 --config-dir 指向这里，同步也写这里，两者一致（media.ts）。
// userMpvPath 是自选 MPV；附带 MPV 不传，它旁边的 portable_config 会被 --config-dir 盖过。
export function getMpvConfigDir(userMpvPath?: string): string {
    return mpvUserConfigDir(
        currentPlatform(),
        { homeDir: os.homedir(), appDataDir: app.getPath('appData') },
        process.env,
        userMpvPath,
        fs.existsSync,
    );
}

// 客户端这次会运行的 MPV（自选 MPV、附带 MPV 或在常见位置找到的 MPV），找不到时是 undefined。托盘显示和播放共用。
export function getCurrentMpvPlayer(): MpvPlayer | undefined {
    const bundledMpvPath = resolveBundledMpvPath({
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged,
    });
    return mpvPlayer(currentPlatform(), fnConfig.getMpvPlayerPath(), bundledMpvPath, fs.existsSync);
}

// 获取应用中的portable_config目录
function getPortableConfigDir(): string {
    return resolvePortableConfigDir({
        appPath: app.getAppPath(),
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
    });
}

// 用安装记录（或便携配置的清单）里的 provides 对照客户端的 requires，不满足记 ERROR、托盘显示状态，不阻塞启动。
function checkCapabilities(input: MpvCapabilityCheckInput): void {
    const status = checkMpvCapabilities(input);
    setMpvCapabilitiesSatisfied(status.satisfied);
    if (!status.satisfied) logger.error(mpvCapabilityErrorMessage(status, input.mpvConfigDir));
}

// 按归档清单同步用户配置。失败只记日志，不阻塞启动，下次启动重试。
function initializeMpvConfig(): void {
    try {
        const mpvConfigDir = getMpvConfigDir(fnConfig.getMpvPlayerPath());
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

// 插件初始化函数
function init(): void {
    logger.info('Initializing MPV Config Plugin...');
    initializeMpvConfig();
}

export {
    init
};
