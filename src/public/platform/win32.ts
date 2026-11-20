import * as path from 'node:path';
import { NOT_PACKAGED, PlatformImpl } from './shared';

export const win32: PlatformImpl = {
    behavior: {
        closeBehaviorSetting: 'exitMode',
        quitsWhenAllWindowsClosed: true,
        hasDock: false,
        titleBar: 'frameless',
        windowIcon: 'icon.ico',
        tray: {
            showWindowLabel: '显示主窗口',
            quitLabel: '退出',
            restoreEvent: 'double-click',
            icon: { file: 'icon.ico', template: false },
            showsMinimizeBalloon: true,
        },
        mpvExecutableExtensions: ['exe'],
        // 总有附带 MPV，用不到。
        mpvNotFoundMessage: '未找到mpv播放器',
        rejectsBasicTextStorage: false,
        treatsUnknownMpvConfAsUserOwned: false,
    },

    /**
     * 漫游 AppData 下的 mpv（osdep/path-win.c）。Windows 不读 XDG_CONFIG_HOME 和 ~/.mpv。
     * 用户自己指定的 mpv.exe（userMpvPath）旁边有 portable_config 时，mpv 只读那里（#114）。
     * 打包的 mpv 有 --config-dir，不传 userMpvPath。
     * scoop 之类的 shim 不在真实 mpv.exe 旁边，按 shim 所在目录找不到 portable_config，这里不处理。
     */
    mpvUserConfigDir(dirs, _env, userMpvPath, pathExists) {
        if (userMpvPath) {
            const portableDir = path.win32.join(path.win32.dirname(userMpvPath), 'portable_config');
            if (pathExists(portableDir)) {
                return portableDir;
            }
        }
        return path.win32.join(dirs.appDataDir, 'mpv');
    },

    /** 附带 MPV，不检查它是否存在。 */
    defaultMpvPlayer(bundledMpvPath) {
        return { path: bundledMpvPath, bundled: true };
    },

    /** 命名管道，不落盘。 */
    mpvIpcSocket(_tmpDir, name) {
        return { path: `\\\\.\\pipe\\${name}`, isFile: false };
    },

    /** NSIS 安装包，打包后就能更新。 */
    inAppUpdateAvailability(isPackaged) {
        return isPackaged ? { available: true } : NOT_PACKAGED;
    },

    installerAssetSuffix: {
        x64: 'win_x64.exe',
    },
};
