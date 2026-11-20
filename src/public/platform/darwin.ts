import { firstExistingMpv, posixMpvIpcSocket, posixMpvUserConfigDir } from './posix';
import { PlatformImpl } from './shared';

const MPV_SEARCH_PATHS = [
    '/opt/homebrew/bin/mpv',                     // Apple Silicon 上的 Homebrew
    '/usr/local/bin/mpv',                        // Intel 上的 Homebrew 或手动安装
    '/Applications/mpv.app/Contents/MacOS/mpv',  // App bundle
];

export const darwin: PlatformImpl = {
    behavior: {
        closeBehaviorSetting: 'macCloseAction',
        quitsWhenAllWindowsClosed: false,
        hasDock: true,
        titleBar: 'hiddenInset',
        windowIcon: 'icon.png',
        tray: {
            showWindowLabel: '显示窗口',
            quitLabel: '退出飞牛影视',
            restoreEvent: 'click',
            icon: { file: 'iconTemplate2.png', template: true },
            showsMinimizeBalloon: false,
        },
        mpvExecutableExtensions: [],
        mpvNotFoundMessage: 'macOS平台未找到mpv播放器，请使用Homebrew安装mpv后重试: brew install mpv',
        rejectsBasicTextStorage: false,
        treatsUnknownMpvConfAsUserOwned: true,
    },

    mpvUserConfigDir: (dirs, env, _userMpvPath, pathExists) => posixMpvUserConfigDir(dirs, env, pathExists),
    defaultMpvPlayer: (_bundledMpvPath, pathExists) => firstExistingMpv(MPV_SEARCH_PATHS, pathExists),
    mpvIpcSocket: posixMpvIpcSocket,

    /** 包没有 Developer ID 签名，装不了。 */
    inAppUpdateAvailability() {
        return { available: false, reason: 'darwin 不支持应用内更新' };
    },

    installerAssetSuffix: {
        x64: 'mac_x64.dmg',
        arm64: 'mac_arm64.dmg',
    },
};
