export type CloseBehaviorSetting = 'macCloseAction' | 'exitMode';

export type CloseBehavior = 'hide' | 'quit' | 'ask';

export interface CloseBehaviorDialog {
    title: string;
    message: string;
    detail: string;
    buttons: { behavior: CloseBehavior; label: string }[];
    defaultBehavior: CloseBehavior;
}

export interface PlatformBehavior {
    closeBehaviorSetting: CloseBehaviorSetting;
    closeBehaviorText: {
        askOnClose: CloseBehaviorDialog;
        settingsMenuLabel: string;
        settings: CloseBehaviorDialog;
    };
    hideNotice: { shownBy: 'notification' | 'trayBalloon'; body: string } | null;
    quitsWhenAllWindowsClosed: boolean;
    hasDock: boolean;
    titleBar: 'hiddenInset' | 'frameless';
    windowIcon: 'icon.ico' | 'icon.png';
    tray: {
        showWindowLabel: string;
        quitLabel: string;
        restoreEvent: 'click' | 'double-click';
        icon: { file: string; template: boolean };
    };
    mpvExecutableExtensions: string[];
    mpvNotFoundMessage: string;
    rejectsBasicTextStorage: boolean;
    treatsUnknownMpvConfAsUserOwned: boolean;
}

export interface UserDirs {
    homeDir: string;
    appDataDir: string;
}

export interface MpvProgram {
    path: string;
    bundled: boolean;
}

export interface MpvIpcSocket {
    path: string;
    isFile: boolean;
}

export type InAppUpdateAvailability = { available: true } | { available: false; reason: string };

export const NOT_PACKAGED: InAppUpdateAvailability = { available: false, reason: '未打包的客户端不做应用内更新' };

export interface PlatformImpl {
    behavior: PlatformBehavior;
    mpvUserConfigDir(
        dirs: UserDirs,
        env: Record<string, string | undefined>,
        userMpvPath: string | undefined,
        pathExists: (target: string) => boolean,
        readTextFile: (target: string) => string | null,
    ): string;
    defaultMpvProgram(bundledMpvPath: string, pathExists: (target: string) => boolean): MpvProgram | undefined;
    mpvIpcSocket(tmpDir: string, name: string): MpvIpcSocket;
    inAppUpdateAvailability(isPackaged: boolean, appImagePath: string | undefined, isWritableDir: (dir: string) => boolean): InAppUpdateAvailability;
    installerAssetSuffix: Partial<Record<string, string>>;
}
