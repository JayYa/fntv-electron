import { app, BrowserWindow, BrowserWindowConstructorOptions, screen } from 'electron';
import * as path from 'path';
import { platformBehavior } from '../../public/platform';
import { USER_DATA_PATH } from '../../public/constants';
import * as preferences from '../../modules/fn_config/preferences';
import * as log from '../../modules/logger';
import { listenForSystemShutdown } from '../../modules/quit/quitCoordinator';
import type { DownloadProgress } from '../../modules/updater/inAppUpdate';
import { closeBehaviorMenuItem, followCloseBehavior, type ShowTrayBalloon } from './closeBehavior';
import { push } from '../ipc/adapter';
import { isLoginPageUrl } from './loginPage';
import { checkLibraryPageUrl } from './utils';
import { WEB_UI_SESSION_PARTITION } from './webUiSession';
import { DisplayLayout, Rect, WindowPlacement, loadWindowPlacement, saveWindowPlacement } from './windowState';

const behavior = platformBehavior();
const isMac = behavior.titleBar === 'hiddenInset';
const windowIconPath = path.join(__dirname, '../../../build', behavior.windowIcon);

const MIN_SIZE = { width: 800, height: 800 };

const windowOptions: BrowserWindowConstructorOptions = {
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
        partition: WEB_UI_SESSION_PARTITION,
        preload: path.join(__dirname, '../../preload/bundle.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        spellcheck: false,
    }
};

let started: BrowserWindow | null = null;

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

function createWindow(): { window: BrowserWindow; maximized: boolean } {
    log.info('主窗口图标:', windowIconPath);
    const placement = loadWindowPlacement(windowStateFile, currentDisplays());
    const { bounds } = placement;
    const window = new BrowserWindow({ ...windowOptions, ...bounds, ...minSizeFittingIn(bounds) });
    trackWindowState(window);
    return { window, maximized: placement.maximized };
}

function toggleMaximized(window: BrowserWindow): void {
    if (window.isMaximized()) {
        window.unmaximize();
    } else {
        window.maximize();
    }
}

function followPreferences(window: BrowserWindow): void {
    preferences.onChange((name) => {
        if (window.isDestroyed()) return;
        push(window.webContents, 'preferences-snapshot', preferences.snapshot());
        if (name !== 'mpvPlayback') return;
        const url = window.webContents.getURL();
        if (!url || isLoginPageUrl(url)) return;
        log.info('MPV 接管开关已改变，重新加载网页端');
        window.webContents.reloadIgnoringCache();
    });
}

function followDownloadProgress(window: BrowserWindow, progress: DownloadProgress): void {
    progress.onChange(percent => {
        if (!window.isDestroyed()) {
            window.setProgressBar(percent === null ? -1 : percent / 100);
        }
    });
}

export interface MainWindowDeps {
    showBalloon: ShowTrayBalloon;
    downloadProgress: DownloadProgress;
}

function current(): BrowserWindow {
    if (!started) throw new Error('主窗口还没有启动');
    return started;
}

export const mainWindow = {
    start(deps: MainWindowDeps): void {
        if (started) throw new Error('主窗口已经启动');
        const { window, maximized } = createWindow();
        started = window;
        window.once('ready-to-show', () => {
            if (maximized) window.maximize();
            window.show();
        });
        window.webContents.on('before-input-event', (event, input) => {
            if (input.type === 'keyDown' && input.key === 'F11') {
                toggleMaximized(window);
                event.preventDefault();
            }
        });
        followCloseBehavior(window, deps.showBalloon);
        followPreferences(window);
        followDownloadProgress(window, deps.downloadProgress);
        listenForSystemShutdown(window);
    },

    window(): BrowserWindow {
        return current();
    },

    show(): void {
        const window = current();
        if (window.isMinimized()) window.restore();
        if (!window.isVisible()) window.show();
        window.focus();
        if (behavior.hasDock) app.dock?.show();
    },

    minimize(): void {
        current().minimize();
    },

    toggleMaximized(): void {
        toggleMaximized(current());
    },

    close(): void {
        current().close();
    },

    reloadWebUi(): void {
        const window = current();
        if (checkLibraryPageUrl(window.webContents.getURL() || '')) return;
        log.info('刷新当前窗口');
        window.webContents.reloadIgnoringCache();
    },

    closeBehaviorMenuItem(): { label: string; click: () => Promise<void> } {
        return closeBehaviorMenuItem(current());
    },
};
