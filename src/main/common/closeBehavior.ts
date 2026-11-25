import { app, dialog, Notification, type BrowserWindow } from 'electron';
import * as preferences from '../../modules/fn_config/preferences';
import * as log from '../../modules/logger';
import { isQuitting } from '../../modules/quit/quitCoordinator';
import { platformBehavior } from '../../public/platform';
import type { CloseBehavior, CloseBehaviorDialog } from '../../public/platform/shared';

let mainWindow: BrowserWindow | null = null;
let showTrayBalloon: ((content: string) => void) | null = null;

async function askCloseBehavior(window: BrowserWindow, text: CloseBehaviorDialog, withRemember: boolean): Promise<{ behavior: CloseBehavior; remember: boolean } | null> {
    const labels = [...text.buttons.map(button => button.label), '取消'];
    const result = await dialog.showMessageBox(window, {
        type: 'question',
        title: text.title,
        message: text.message,
        detail: text.detail,
        buttons: labels,
        defaultId: text.buttons.findIndex(button => button.behavior === text.defaultBehavior),
        cancelId: labels.length - 1,
        ...(withRemember ? { checkboxLabel: '记住我的选择', checkboxChecked: false } : {}),
    });
    const chosen = text.buttons[result.response];
    return chosen ? { behavior: chosen.behavior, remember: result.checkboxChecked } : null;
}

function noticeHidden(): void {
    const notice = platformBehavior().hideNotice;
    if (!notice || preferences.trayNotificationShown()) return;
    if (notice.shownBy === 'notification') {
        if (Notification.isSupported()) {
            new Notification({ title: '飞牛影视', body: notice.body, silent: false }).show();
        }
    } else {
        if (!showTrayBalloon) return;
        showTrayBalloon(notice.body);
    }
    preferences.markTrayNotificationShown();
}

function hide(window: BrowserWindow): void {
    window.hide();
    if (platformBehavior().hasDock) app.dock?.hide();
    noticeHidden();
}

async function handleClose(window: BrowserWindow): Promise<void> {
    let behavior = preferences.get('closeBehavior');
    if (behavior === 'ask') {
        const choice = await askCloseBehavior(window, platformBehavior().closeBehaviorText.askOnClose, true);
        if (!choice) return;
        if (choice.remember) preferences.set('closeBehavior', choice.behavior);
        behavior = choice.behavior;
    }
    if (behavior === 'hide') {
        hide(window);
    } else {
        app.quit();
    }
}

export function manageMainWindow(window: BrowserWindow): void {
    mainWindow = window;
    window.on('close', (event) => {
        if (isQuitting()) return;
        event.preventDefault();
        handleClose(window).catch(error => log.error('处理关闭主窗口失败:', error));
    });
}

export function provideTrayBalloon(show: (content: string) => void): void {
    showTrayBalloon = show;
}

export function showMainWindow(): void {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    if (platformBehavior().hasDock) app.dock?.show();
}

export function closeBehaviorMenuItem(): { label: string; click: () => Promise<void> } {
    const text = platformBehavior().closeBehaviorText;
    return {
        label: text.settingsMenuLabel,
        async click() {
            if (!mainWindow) return;
            const choice = await askCloseBehavior(mainWindow, text.settings, false);
            if (choice) preferences.set('closeBehavior', choice.behavior);
        },
    };
}
