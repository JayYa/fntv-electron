import { BrowserWindow, BrowserWindowConstructorOptions, screen } from 'electron';
import * as path from 'path';
import { platformBehavior } from '../../public/platform';
import { USER_DATA_PATH } from '../../public/constants';
import * as log from '../../modules/logger';
import { DisplayLayout, Rect, WindowPlacement, loadWindowPlacement, saveWindowPlacement } from './windowState';

const behavior = platformBehavior();
const isMac = behavior.titleBar === 'hiddenInset';
const windowIconPath = path.join(__dirname, '../../../build', behavior.windowIcon);

const MIN_SIZE = { width: 800, height: 800 };

const mainwinConfig: BrowserWindowConstructorOptions = {
    autoHideMenuBar: true,
    show: false,
    icon: windowIconPath,
    frame: isMac,
    ...(isMac && {
        titleBarStyle: 'hiddenInset' as const,
        trafficLightPosition: { x: 14, y: 14 },
    }),
    webPreferences: {
        webgl: true,
        partition: 'persist:fntv',
        preload: path.join(__dirname, '../../preload/bundle.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        spellcheck: false,
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

export function getMainWindow(): BrowserWindow {
    if (!mainwin) {
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
