import * as path from 'node:path';
import { firstExistingMpv, posixMpvIpcSocket, posixMpvUserConfigDir } from './posix';
import { NOT_PACKAGED, PlatformImpl } from './shared';

const MPV_SEARCH_PATHS = [
    '/usr/bin/mpv',       // 系统包管理器
    '/usr/local/bin/mpv', // 手动编译安装
    '/snap/bin/mpv',      // Snap
    '/usr/games/mpv',     // 某些发行版
    '/opt/mpv/bin/mpv',   // 可选安装位置
];

export const linux: PlatformImpl = {
    behavior: {
        closeBehaviorSetting: 'exitMode',
        quitsWhenAllWindowsClosed: true,
        hasDock: false,
        titleBar: 'frameless',
        windowIcon: 'icon.png',
        tray: {
            showWindowLabel: '显示主窗口',
            quitLabel: '退出',
            restoreEvent: 'click',
            icon: { file: 'icon.png', template: false },
            showsMinimizeBalloon: false,
        },
        mpvExecutableExtensions: [],
        mpvNotFoundMessage: 'Linux平台未找到mpv播放器，请安装mpv播放器后重试',
        rejectsBasicTextStorage: true,
        treatsUnknownMpvConfAsUserOwned: true,
    },

    mpvUserConfigDir: (dirs, env, _userMpvPath, pathExists) => posixMpvUserConfigDir(dirs, env, pathExists),
    defaultMpvPlayer: (_bundledMpvPath, pathExists) => firstExistingMpv(MPV_SEARCH_PATHS, pathExists),
    mpvIpcSocket: posixMpvIpcSocket,

    /**
     * electron-updater 删掉 APPIMAGE 指向的文件，把新 AppImage 移到同一目录，所以要以 AppImage 运行
     * （appImagePath 是 APPIMAGE 环境变量，解包后运行时没有），并且这个目录可写。
     */
    inAppUpdateAvailability(isPackaged, appImagePath, isWritableDir) {
        if (!isPackaged) {
            return NOT_PACKAGED;
        }
        if (!appImagePath) {
            return { available: false, reason: '没有以 AppImage 运行（APPIMAGE 未设置），不做应用内更新' };
        }
        if (!isWritableDir(path.posix.dirname(appImagePath))) {
            return { available: false, reason: 'AppImage 所在目录不可写' };
        }
        return { available: true };
    },

    // 打包工具给 x64 的架构名是 x86_64，以 v2.7.0 的真实资产核对过。
    installerAssetSuffix: {
        x64: 'linux_x86_64.AppImage',
        arm64: 'linux_arm64.AppImage',
    },
};
