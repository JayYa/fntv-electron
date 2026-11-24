import * as path from 'node:path';
import { NOT_PACKAGED, PlatformImpl } from './shared';

const SHIM_PATH_LINE = /^\s*path\s*=\s*(.*?)\s*$/;

function scoopShimTarget(userMpvPath: string, readTextFile: (target: string) => string | null): string | undefined {
    const shimFile = userMpvPath.replace(/\.exe$/i, '.shim');
    if (shimFile === userMpvPath) {
        return undefined;
    }
    const lines = (readTextFile(shimFile) ?? '').replace(/^﻿/, '').split(/\r?\n/);
    for (const line of lines) {
        const target = SHIM_PATH_LINE.exec(line)?.[1].replace(/^"(.*)"$/, '$1').trim();
        if (target && path.win32.isAbsolute(target)) {
            return target;
        }
    }
    return undefined;
}

function userMpvLocations(userMpvPath: string | undefined, readTextFile: (target: string) => string | null): string[] {
    if (!userMpvPath) {
        return [];
    }
    const shimTarget = scoopShimTarget(userMpvPath, readTextFile);
    return shimTarget ? [userMpvPath, shimTarget] : [userMpvPath];
}

export const win32: PlatformImpl = {
    behavior: {
        closeBehaviorSetting: 'exitMode',
        closeBehaviorText: {
            askOnClose: {
                title: '退出确认',
                message: '确定要退出飞牛影视吗？',
                detail: '您可以选择完全退出应用或最小化到托盘。',
                buttons: [
                    { behavior: 'quit', label: '退出应用' },
                    { behavior: 'hide', label: '最小化到托盘' },
                ],
                defaultBehavior: 'hide',
            },
            settingsMenuLabel: '退出行为设置',
            settings: {
                title: '退出行为设置',
                message: '设置点击退出时的行为',
                detail: '您可以选择单击退出时的默认行为。',
                buttons: [
                    { behavior: 'quit', label: '直接退出' },
                    { behavior: 'hide', label: '最小化到托盘' },
                    { behavior: 'ask', label: '每次询问' },
                ],
                defaultBehavior: 'ask',
            },
        },
        hideNotice: { shownBy: 'trayBalloon', body: '应用已最小化到托盘，双击托盘图标或右键菜单可以恢复窗口' },
        quitsWhenAllWindowsClosed: true,
        hasDock: false,
        titleBar: 'frameless',
        windowIcon: 'icon.ico',
        tray: {
            showWindowLabel: '显示主窗口',
            quitLabel: '退出',
            restoreEvent: 'double-click',
            icon: { file: 'icon.ico', template: false },
        },
        mpvExecutableExtensions: ['exe'],
        mpvNotFoundMessage: '未找到mpv播放器',
        rejectsBasicTextStorage: false,
        treatsUnknownMpvConfAsUserOwned: false,
    },

    mpvUserConfigDir(dirs, _env, userMpvPath, pathExists, readTextFile) {
        for (const mpvPath of userMpvLocations(userMpvPath, readTextFile)) {
            const portableDir = path.win32.join(path.win32.dirname(mpvPath), 'portable_config');
            if (pathExists(portableDir)) {
                return portableDir;
            }
        }
        return path.win32.join(dirs.appDataDir, 'mpv');
    },

    defaultMpvProgram(bundledMpvPath) {
        return { path: bundledMpvPath, bundled: true };
    },

    mpvIpcSocket(_tmpDir, name) {
        return { path: `\\\\.\\pipe\\${name}`, isFile: false };
    },

    inAppUpdateAvailability(isPackaged) {
        return isPackaged ? { available: true } : NOT_PACKAGED;
    },

    installerAssetSuffix: {
        x64: 'win_x64.exe',
    },
};
