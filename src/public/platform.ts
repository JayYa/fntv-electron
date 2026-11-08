import * as path from 'node:path';

/**
 * 平台差异集中在这里。读取 process.platform 和 process.arch 只在本文件发生（eslint.config.mjs 的
 * no-restricted-properties），其它模块用 currentPlatform() 取得当前平台，再把它传给下面的纯函数。
 * 纯函数接收平台参数，测试可以在任意主机上覆盖 Windows、macOS 和 Linux 三条分支（tests/platform.test.cjs）。
 *
 * currentPlatform() 每次调用时读取，不缓存：已有测试通过改写 process.platform 模拟其它平台。
 */

export function currentPlatform(): NodeJS.Platform {
    return process.platform;
}

export function currentArch(): string {
    return process.arch;
}

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
    tray: {
        showWindowLabel: string;
        quitLabel: string;
        /** 哪个托盘事件恢复窗口；Linux 不绑定。 */
        restoreEvent: 'click' | 'double-click' | null;
        /** build/ 下的图标文件。template 为 true 时是 macOS 模板图标，加载失败时回退到 icon.png。 */
        icon: { file: string; template: boolean };
        /** 最小化到托盘后是否弹出一次气泡提示。 */
        showsMinimizeBalloon: boolean;
    };
    /** 选择 MPV 播放器时“可执行文件”过滤器的扩展名。 */
    mpvExecutableExtensions: string[];
    /** safeStorage 后端是 basic_text 时拒绝保存凭据。只有 Linux 会落到这个后端。 */
    rejectsBasicTextStorage: boolean;
}

export function platformBehavior(platform: NodeJS.Platform = currentPlatform()): PlatformBehavior {
    const isMac = platform === 'darwin';
    const isWindows = platform === 'win32';
    return {
        closeBehaviorSetting: isMac ? 'macCloseAction' : 'exitMode',
        quitsWhenAllWindowsClosed: !isMac,
        hasDock: isMac,
        titleBar: isMac ? 'hiddenInset' : 'frameless',
        tray: {
            showWindowLabel: isMac ? '显示窗口' : '显示主窗口',
            quitLabel: isMac ? '退出飞牛影视' : '退出',
            restoreEvent: isMac ? 'click' : isWindows ? 'double-click' : null,
            icon: isMac
                ? { file: 'iconTemplate2.png', template: true }
                : { file: isWindows ? 'icon.ico' : 'icon.png', template: false },
            showsMinimizeBalloon: isWindows,
        },
        mpvExecutableExtensions: isWindows ? ['exe'] : [],
        rejectsBasicTextStorage: platform === 'linux',
    };
}

/** 目标平台的路径写法：结果和在该平台上运行时一致，与测试所在主机无关。 */
function pathFor(platform: NodeJS.Platform): path.PlatformPath {
    return platform === 'win32' ? path.win32 : path.posix;
}

/**
 * Proxy 可执行文件的绝对路径，不依赖当前工作目录（从快捷方式、开机自启或命令行启动时工作目录不一定是安装目录）。
 * 打包后 package.json 的 extraFiles 把 third_party/proxy 放在 app.asar 上两级目录：
 * Windows 和 Linux 是安装目录，macOS 是 .app/Contents。未打包时 appPath 是项目根目录。
 */
export function proxyExecutablePath(platform: NodeJS.Platform, app: { isPackaged: boolean; appPath: string }): string {
    const p = pathFor(platform);
    const baseDir = app.isPackaged ? p.dirname(p.dirname(app.appPath)) : app.appPath;
    return p.join(baseDir, 'third_party', 'proxy', platform === 'win32' ? 'proxy.exe' : 'proxy');
}

/** 用户 MPV 配置目录：Windows 是 ~/AppData/Roaming/mpv，其它平台是 ~/.config/mpv（docs/external-runtime.md）。 */
export function mpvUserConfigDir(platform: NodeJS.Platform, homeDir: string): string {
    return platform === 'win32'
        ? path.win32.join(homeDir, 'AppData', 'Roaming', 'mpv')
        : path.posix.join(homeDir, '.config', 'mpv');
}
