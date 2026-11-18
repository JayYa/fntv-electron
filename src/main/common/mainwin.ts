import { BrowserWindow, BrowserWindowConstructorOptions, screen } from 'electron';
import * as path from 'path';
import { platformBehavior } from '../../public/platform';
import { USER_DATA_PATH } from '../../public/constants';
import * as log from '../../modules/logger';
import { DisplayLayout, WindowPlacement, loadWindowPlacement, saveWindowPlacement } from './windowState';

const behavior = platformBehavior();
const isMac = behavior.titleBar === 'hiddenInset';
// 打包后 build/ 在 app.asar 里（package.json 的 files），nativeImage 能直接读 asar 内的文件。
const windowIconPath = path.join(__dirname, '../../../build', behavior.windowIcon);

const MIN_SIZE = { width: 800, height: 800 };

// 大小、位置和最小尺寸在 getMainWindow 里按上次保存的状态给出，首次启动是 1400×800（windowState.ts）。
const mainwinConfig: BrowserWindowConstructorOptions = {
    autoHideMenuBar: true,
    show: false,
    icon: windowIconPath,
    // macOS 使用系统交通灯按钮，但让现有页面继续延伸到标题栏区域。
    // Windows/Linux 保持原有的无边框窗口和自定义窗口按钮。
    frame: isMac,
    ...(isMac && {
        titleBarStyle: 'hiddenInset' as const,
        trafficLightPosition: { x: 14, y: 14 },
    }),
    // transparent: true,
    webPreferences: {
        webgl: true,
        partition: 'persist:fntv',
        preload: path.join(__dirname, '../../preload/bundle.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        spellcheck: false,  // 禁用拼写检查，避免输入法干扰
    }
};

let mainwin: BrowserWindow | null = null;
let startMaximized = false;

const windowStateFile = path.join(USER_DATA_PATH, 'window-state.json');
// 拖动和缩放时事件连续触发，停下来这么久才写一次文件。
const SAVE_DELAY_MS = 500;

function currentDisplays(): DisplayLayout {
    return {
        workAreas: screen.getAllDisplays().map((display) => display.workArea),
        primary: screen.getPrimaryDisplay().workArea,
    };
}

/**
 * 窗口大小、位置或最大化状态一变就记下，停下来后写入文件；关闭窗口时立即补写。
 * 最小化和全屏期间不记，留着进入之前的状态，下次启动按那个状态打开。
 */
function trackWindowState(win: BrowserWindow): void {
    let pending: WindowPlacement | null = null;
    let timer: NodeJS.Timeout | undefined;

    const capture = (): void => {
        if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
        // getNormalBounds 在最大化时也返回还原后的大小和位置。
        pending = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
    };
    const flush = (): void => {
        clearTimeout(timer);
        timer = undefined;
        if (!pending) return;
        try {
            saveWindowPlacement(windowStateFile, pending);
        } catch (error) {
            log.warn('保存窗口状态失败:', error);
        }
        pending = null;
    };
    const schedule = (): void => {
        capture();
        clearTimeout(timer);
        timer = setTimeout(flush, SAVE_DELAY_MS);
    };

    win.on('resize', schedule);
    win.on('move', schedule);
    win.on('maximize', schedule);
    win.on('unmaximize', schedule);
    win.on('close', () => {
        capture();
        flush();
    });
}

/**
 * 获取主窗口实例
 * @returns {BrowserWindow}
 */
export function getMainWindow(): BrowserWindow {
    if (!mainwin) {
        // 冒烟测试从这行读出路径，检查图标能加载（tests/smoke/installer.smoke.cjs）。
        log.info('主窗口图标:', windowIconPath);
        const placement = loadWindowPlacement(windowStateFile, currentDisplays());
        startMaximized = placement.maximized;
        const { bounds } = placement;
        mainwin = new BrowserWindow({
            ...mainwinConfig,
            ...bounds,
            // 屏幕可用区域比最小尺寸还小时（如 1366×768），放宽最小尺寸，否则窗口会被撑出屏幕。
            minWidth: Math.min(MIN_SIZE.width, bounds.width),
            minHeight: Math.min(MIN_SIZE.height, bounds.height),
        });
        trackWindowState(mainwin);
    }
    return mainwin;
}

/** 上次退出时主窗口是最大化的，首次显示时应当最大化。 */
export function shouldStartMaximized(): boolean {
    return startMaximized;
}
