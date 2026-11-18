import { BrowserWindow, BrowserWindowConstructorOptions, screen } from 'electron';
import * as path from 'path';
import { platformBehavior } from '../../public/platform';
import { USER_DATA_PATH } from '../../public/constants';
import * as log from '../../modules/logger';
import { DisplayLayout, Rect, WindowPlacement, loadWindowPlacement, saveWindowPlacement } from './windowState';

const behavior = platformBehavior();
const isMac = behavior.titleBar === 'hiddenInset';
// 打包后 build/ 在 app.asar 里（package.json 的 files），nativeImage 能直接读 asar 内的文件。
const windowIconPath = path.join(__dirname, '../../../build', behavior.windowIcon);

const MIN_SIZE = { width: 800, height: 800 };

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
const SAVE_DEBOUNCE_MS = 500;

function currentDisplays(): DisplayLayout {
    return {
        workAreas: screen.getAllDisplays().map((display) => display.workArea),
        primaryWorkArea: screen.getPrimaryDisplay().workArea,
    };
}

function minSizeFittingIn(bounds: Rect): { minWidth: number; minHeight: number } {
    return {
        minWidth: Math.min(MIN_SIZE.width, bounds.width),
        minHeight: Math.min(MIN_SIZE.height, bounds.height),
    };
}

function isRecordable(win: BrowserWindow): boolean {
    return !win.isDestroyed() && !win.isMinimized() && !win.isFullScreen();
}

function trackWindowState(win: BrowserWindow): void {
    let pending: WindowPlacement | null = null;
    let timer: NodeJS.Timeout | undefined;

    const capture = (): void => {
        if (!isRecordable(win)) return;
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
        timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
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
        mainwin = new BrowserWindow({ ...mainwinConfig, ...bounds, ...minSizeFittingIn(bounds) });
        trackWindowState(mainwin);
    }
    return mainwin;
}

export function shouldStartMaximized(): boolean {
    return startMaximized;
}
