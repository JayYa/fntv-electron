import { firstExistingMpv, posixMpvIpcSocket, posixMpvUserConfigDir } from './posix';
import { PlatformImpl } from './shared';

const MPV_SEARCH_PATHS = [
    '/opt/homebrew/bin/mpv',
    '/usr/local/bin/mpv',
    '/Applications/mpv.app/Contents/MacOS/mpv',
];

export const darwin: PlatformImpl = {
    behavior: {
        closeBehaviorSetting: 'macCloseAction',
        closeBehaviorText: {
            askOnClose: {
                title: '关闭窗口',
                message: '您希望如何处理窗口关闭？',
                detail: '在 macOS 上，您可以选择隐藏到状态栏或完全退出应用。',
                buttons: [
                    { behavior: 'hide', label: '隐藏到状态栏' },
                    { behavior: 'quit', label: '退出应用' },
                ],
                defaultBehavior: 'hide',
            },
            settingsMenuLabel: '关闭行为设置',
            settings: {
                title: '关闭行为设置',
                message: '设置点击关闭按钮时的行为',
                detail: '您可以选择关闭窗口时的默认行为。',
                buttons: [
                    { behavior: 'hide', label: '隐藏到状态栏' },
                    { behavior: 'quit', label: '退出应用' },
                    { behavior: 'ask', label: '每次询问' },
                ],
                defaultBehavior: 'ask',
            },
        },
        hideNotice: { shownBy: 'notification', body: '应用已隐藏到状态栏，点击状态栏图标可以恢复窗口' },
        quitsWhenAllWindowsClosed: false,
        hasDock: true,
        titleBar: 'hiddenInset',
        windowIcon: 'icon.png',
        tray: {
            showWindowLabel: '显示窗口',
            quitLabel: '退出飞牛影视',
            restoreEvent: 'click',
            icon: { file: 'iconTemplate2.png', template: true },
        },
        mpvExecutableExtensions: [],
        mpvNotFoundMessage: 'macOS平台未找到mpv播放器，请使用Homebrew安装mpv后重试: brew install mpv',
        rejectsBasicTextStorage: false,
        treatsUnknownMpvConfAsUserOwned: true,
    },

    mpvUserConfigDir: (dirs, env, _userMpvPath, pathExists) => posixMpvUserConfigDir(dirs, env, pathExists),
    defaultMpvPlayer: (_bundledMpvPath, pathExists) => firstExistingMpv(MPV_SEARCH_PATHS, pathExists),
    mpvIpcSocket: posixMpvIpcSocket,

    inAppUpdateAvailability() {
        return { available: false, reason: 'darwin 不支持应用内更新' };
    },

    installerAssetSuffix: {
        x64: 'mac_x64.dmg',
        arm64: 'mac_arm64.dmg',
    },
};
