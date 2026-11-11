import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as fnConfig from '../../../modules/fn_config/config';
import * as logger from '../../../modules/logger';
import {
    resolveBundledMpvPath,
    resolvePortableConfigDir,
    synchronizeMpvConfig,
} from '../../common/mpvConfigHelpers';
import { currentPlatform, mpvPlayerPath, mpvUserConfigDir } from '../../../public/platform';

/**
 * MPV配置文件管理插件
 * 初始化用户 MPV 配置，并同步由应用托管的插件代码。
 */

// 获取用户MPV配置目录。打包的 mpv 用 --config-dir 指向这里，同步也写这里，两者一致（media.ts）。
// userMpvPath 是用户自己指定的 mpv；打包的 mpv 不传，它旁边的 portable_config 会被 --config-dir 盖过。
export function getMpvConfigDir(userMpvPath?: string): string {
    return mpvUserConfigDir(
        currentPlatform(),
        { homeDir: os.homedir(), appDataDir: app.getPath('appData') },
        process.env,
        userMpvPath,
        fs.existsSync,
    );
}

// 客户端这次会运行的 mpv（自选 MPV、附带 MPV 或在常见位置找到的 mpv），找不到时是 undefined。托盘显示和播放共用。
export function getCurrentMpvPlayerPath(): string | undefined {
    const bundledMpvPath = resolveBundledMpvPath({
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged,
    });
    return mpvPlayerPath(currentPlatform(), fnConfig.getMpvPlayerPath(), bundledMpvPath, fs.existsSync);
}

// 获取应用中的portable_config目录
function getPortableConfigDir(): string {
    return resolvePortableConfigDir({
        appPath: app.getAppPath(),
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
    });
}

// 检查并复制配置文件
function initializeMpvConfig(): void {
    try {
        const mpvConfigDir = getMpvConfigDir(fnConfig.getMpvPlayerPath());
        const portableConfigDir = getPortableConfigDir();
        const result = synchronizeMpvConfig(portableConfigDir, mpvConfigDir);
        if (result === 'initialized') {
            logger.info(`MPV配置初始化完成: ${mpvConfigDir}`);
        } else if (result === 'same-directory') {
            // 自选 mpv 就是附带的 mpv：它读的就是来源目录，同步会把来源自己删掉。
            logger.info(`MPV配置目录就是便携配置，跳过同步: ${mpvConfigDir}`);
        } else {
            logger.info('MPV托管插件已同步: uosc_danmaku');
        }

    } catch (error) {
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
