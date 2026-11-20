/** 关闭主窗口时读哪项设置：macOS 是 macCloseAction（隐藏到状态栏），其它平台是 exitMode（最小化到托盘）。 */
export type CloseBehaviorSetting = 'macCloseAction' | 'exitMode';

export interface PlatformBehavior {
    /** 关闭主窗口时读哪项设置，也决定托盘菜单显示“关闭行为设置”还是“退出行为设置”。 */
    closeBehaviorSetting: CloseBehaviorSetting;
    /** 所有窗口关闭后是否退出应用。macOS 保持运行，等 dock 图标重新打开窗口。 */
    quitsWhenAllWindowsClosed: boolean;
    /** 有 dock：恢复窗口时显示 dock 图标，隐藏到状态栏时隐藏，activate 时重建窗口。 */
    hasDock: boolean;
    /** macOS 用系统交通灯按钮（hiddenInset），其它平台是无边框窗口加页面里的自定义按钮。 */
    titleBar: 'hiddenInset' | 'frameless';
    /** build/ 下的主窗口图标文件。Electron 的 nativeImage 只在 Windows 上读 ICO，其它平台用 PNG（#74）。 */
    windowIcon: 'icon.ico' | 'icon.png';
    tray: {
        showWindowLabel: string;
        quitLabel: string;
        /** 哪个托盘事件恢复窗口。Linux 上用户激活托盘图标时发 click，没有 double-click（#75）。 */
        restoreEvent: 'click' | 'double-click';
        /** build/ 下的图标文件。template 为 true 时是 macOS 模板图标，加载失败时回退到 icon.png。 */
        icon: { file: string; template: boolean };
        /** 最小化到托盘后是否弹出一次气泡提示。 */
        showsMinimizeBalloon: boolean;
    };
    /** 选择 MPV 播放器时“可执行文件”过滤器的扩展名。 */
    mpvExecutableExtensions: string[];
    /** 播放时找不到 MPV 的提示。Windows 总有附带 MPV，用不到这条。 */
    mpvNotFoundMessage: string;
    /** safeStorage 后端是 basic_text 时拒绝保存凭据。只有 Linux 会落到这个后端。 */
    rejectsBasicTextStorage: boolean;
    /**
     * 同步时，没有安装记录、内容也不在历史哈希里的 `mpv.conf` 是用户自己的配置，不写 `.fntv-new`、不算冲突。
     * macOS 和 Linux 的用户配置就是用户日常用系统 MPV 的目录（#219 用户故事 15）。
     */
    treatsUnknownMpvConfAsUserOwned: boolean;
}

export interface UserDirs {
    /** os.homedir()。 */
    homeDir: string;
    /** app.getPath('appData')。Windows 上是漫游 AppData，与 mpv 用的 FOLDERID_RoamingAppData 是同一个目录。 */
    appDataDir: string;
}

export interface MpvPlayer {
    path: string;
    /** 是附带 MPV。播放时要用 --config-dir 把它指向用户配置，否则它读安装目录里的 portable_config。 */
    bundled: boolean;
}

/** MPV JSON IPC 的地址。isFile 为 true 时它是文件系统里的 Unix socket，播放结束后由调用方删除。 */
export interface MpvIpcSocket {
    path: string;
    isFile: boolean;
}

/** 能不能做应用内更新。不能时 reason 写进日志，提示框改回手动更新的按钮。 */
export type InAppUpdateAvailability = { available: true } | { available: false; reason: string };

export const NOT_PACKAGED: InAppUpdateAvailability = { available: false, reason: '未打包的客户端不做应用内更新' };

/**
 * 一个平台的全部差异。win32.ts、darwin.ts、linux.ts 各实现一份，index.ts 按平台查表取用。
 * 各平台共有的规则（MPV_HOME 优先、自选 MPV 优先、IPC 名字的前缀）在 index.ts，这里只放不同的部分。
 * 实现不读当前平台和文件系统，需要的值由参数传入，测试可以在任意主机上覆盖三个平台。
 */
export interface PlatformImpl {
    behavior: PlatformBehavior;
    /** 没有 MPV_HOME 时的用户 MPV 配置目录。 */
    mpvUserConfigDir(dirs: UserDirs, env: Record<string, string | undefined>, userMpvPath: string | undefined, pathExists: (target: string) => boolean): string;
    /** 没有自选 MPV 时运行的 MPV，找不到时是 undefined。 */
    defaultMpvPlayer(bundledMpvPath: string, pathExists: (target: string) => boolean): MpvPlayer | undefined;
    /** name 是不带扩展名的唯一名字。 */
    mpvIpcSocket(tmpDir: string, name: string): MpvIpcSocket;
    inAppUpdateAvailability(isPackaged: boolean, appImagePath: string | undefined, isWritableDir: (dir: string) => boolean): InAppUpdateAvailability;
    /**
     * 按架构给出安装包名里 `FNMedia_${version}_` 之后的部分，对应 package.json 的 artifactName。
     * 没有这个架构的安装包时不写。
     */
    installerAssetSuffix: Partial<Record<string, string>>;
}
