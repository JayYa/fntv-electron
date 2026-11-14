import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as fnConfig from '../../../modules/fn_config/config';
import * as logger from '../../../modules/logger';
import { resolveBundledMpvPath, resolvePortableConfigDir } from '../../common/mpvConfigHelpers';
import {
    checkMpvCapabilities,
    type MpvCapabilityCheckInput,
    mpvCapabilityErrorMessage,
} from '../../common/mpvConfigSync/capabilities';
import { mpvConfigSyncLogLines } from '../../common/mpvConfigSync/log';
import { resolveManifestPath } from '../../common/mpvConfigSync/manifest';
import { synchronizeMpvConfig } from '../../common/mpvConfigSync/sync';
import { currentPlatform, mpvPlayer, MpvPlayer, mpvUserConfigDir } from '../../../public/platform';

/**
 * MPV配置文件管理插件
 * 启动时按 MPV 归档清单把便携配置同步到用户配置（src/main/common/mpvConfigSync）。
 */

// 获取用户MPV配置目录。附带 MPV 用 --config-dir 指向这里，同步也写这里，两者一致（media.ts）。
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

// 启动时的能力检查结果；检查本身出错时也当作不满足。只在启动时算一次，托盘每次重建菜单都读它。
let capabilitiesSatisfied = true;

// 不满足时托盘“设置”子菜单里的一条状态，满足时没有。原因写在日志里。
export function mpvCapabilityTrayItems(): Electron.MenuItemConstructorOptions[] {
    if (capabilitiesSatisfied) return [];
    return [{ label: 'MPV 插件需要更新，片头片尾跳过等功能可能不可用（详见日志）', enabled: false }];
}

// 用安装记录（或便携配置的清单）里的 provides 对照客户端的 requires，不满足只记 ERROR，不阻塞启动。
function checkCapabilities(input: MpvCapabilityCheckInput): void {
    const status = checkMpvCapabilities(input);
    capabilitiesSatisfied = status.satisfied;
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
    } catch (error) {
        capabilitiesSatisfied = false;
        logger.error('初始化MPV配置失败:', error);
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
