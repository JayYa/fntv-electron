import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as logger from '../../../modules/logger';

/**
 * MPV配置文件管理插件
 * 初始化用户 MPV 配置，并同步由应用托管的插件代码。
 */

// 获取用户MPV配置目录
export function getMpvConfigDir(): string {
    const homeDir = os.homedir();
    if (process.platform === 'win32') {
        return path.join(homeDir, 'AppData', 'Roaming', 'mpv');
    } else {
        return path.join(homeDir, '.config', 'mpv');
    }
}

// 获取应用中的portable_config目录
function getPortableConfigDir(): string {
    if (!app.isPackaged) {
        return path.join(app.getAppPath(), 'third_party', 'fntv-mpv', 'portable_config');
    }

    if (process.platform === 'darwin') {
        // macOS: third_party目录在应用包的Contents目录下，而不是在app.asar内
        // 构建时只复制了portable_config目录内容到third_party/fntv-mpv/portable_config
        const appPath = app.getAppPath();
        const contentsPath = path.dirname(path.dirname(appPath)); // 从app.asar向上两级到Contents
        return path.join(contentsPath, 'third_party', 'fntv-mpv', 'portable_config');
    } else if (process.platform === 'win32') {
        return path.join(process.resourcesPath, 'third_party', 'fntv-mpv', 'portable_config');
    } else {
        return path.join(process.resourcesPath, 'third_party', 'fntv-mpv', 'portable_config');
    }
}

// 递归复制目录
function copyDirectoryRecursive(source: string, destination: string): void {
    if (!fs.existsSync(source)) {
        logger.log(`Source directory does not exist: ${source}`);
        return;
    }

    // 创建目标目录
    if (!fs.existsSync(destination)) {
        fs.mkdirSync(destination, { recursive: true });
    }

    const items = fs.readdirSync(source);

    items.forEach(item => {
        const sourcePath = path.join(source, item);
        const destPath = path.join(destination, item);

        const stat = fs.statSync(sourcePath);

        if (stat.isDirectory()) {
            copyDirectoryRecursive(sourcePath, destPath);
        } else {
            fs.copyFileSync(sourcePath, destPath);
            logger.log(`Copied: ${sourcePath} -> ${destPath}`);
        }
    });
}

// 检查并复制配置文件
function initializeMpvConfig(): void {
    try {
        const mpvConfigDir = getMpvConfigDir();
        const scriptsDir = path.join(mpvConfigDir, 'scripts');
        const portableConfigDir = getPortableConfigDir();

        if (!fs.existsSync(portableConfigDir)) {
            throw new Error(`Portable config directory not found: ${portableConfigDir}`);
        }

        if (!fs.existsSync(scriptsDir)) {
            logger.info('MPV配置尚未初始化，从随包配置创建用户配置');

            // 确保MPV配置目录存在
            if (!fs.existsSync(mpvConfigDir)) {
                fs.mkdirSync(mpvConfigDir, { recursive: true });
                logger.log(`Created MPV config directory: ${mpvConfigDir}`);
            }

            copyDirectoryRecursive(portableConfigDir, mpvConfigDir);
            logger.info(`MPV配置初始化完成: ${mpvConfigDir}`);
        } else {
            // 只更新应用托管的插件源代码；script-opts 和 danmaku-history.json
            // 属于用户状态，升级时必须保留。
            const managedPlugin = 'uosc_danmaku';
            const sourcePluginDir = path.join(portableConfigDir, 'scripts', managedPlugin);
            const destinationPluginDir = path.join(scriptsDir, managedPlugin);
            if (!fs.existsSync(sourcePluginDir)) {
                throw new Error(`Managed MPV plugin not found: ${sourcePluginDir}`);
            }
            fs.rmSync(destinationPluginDir, { recursive: true, force: true });
            copyDirectoryRecursive(sourcePluginDir, destinationPluginDir);
            logger.info(`MPV托管插件已同步: ${managedPlugin}`);
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
