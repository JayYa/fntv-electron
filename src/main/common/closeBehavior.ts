import { app, dialog, Notification, type BrowserWindow } from 'electron';
import * as preferences from '../../modules/fn_config/preferences';
import * as log from '../../modules/logger';
import { isQuitting } from '../../modules/quit/quitCoordinator';
import { platformBehavior } from '../../public/platform';
import type { CloseBehavior, CloseBehaviorDialog } from '../../public/platform/shared';

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

function noticeHidden(showTrayBalloon: (content: string) => void): void {
    const notice = platformBehavior().hideNotice;
    if (!notice || preferences.trayNotificationShown()) return;
    if (notice.shownBy === 'notification') {
        if (Notification.isSupported()) {
            new Notification({ title: '飞牛影视', body: notice.body, silent: false }).show();
        }
    } else {
        showTrayBalloon(notice.body);
    }
    preferences.markTrayNotificationShown();
}

function hide(window: BrowserWindow, showTrayBalloon: (content: string) => void): void {
    window.hide();
    if (platformBehavior().hasDock) app.dock?.hide();
    noticeHidden(showTrayBalloon);
}

async function handleClose(window: BrowserWindow, showTrayBalloon: (content: string) => void): Promise<void> {
    let behavior = preferences.get('closeBehavior');
    if (behavior === 'ask') {
        const choice = await askCloseBehavior(window, platformBehavior().closeBehaviorText.askOnClose, true);
        if (!choice) return;
        if (choice.remember) preferences.set('closeBehavior', choice.behavior);
        behavior = choice.behavior;
    }
    if (behavior === 'hide') {
        hide(window, showTrayBalloon);
    } else {
        app.quit();
    }
}

export function followCloseBehavior(window: BrowserWindow, showTrayBalloon: (content: string) => void): void {
    window.on('close', (event) => {
        if (isQuitting()) return;
        event.preventDefault();
        handleClose(window, showTrayBalloon).catch(error => log.error('处理关闭主窗口失败:', error));
    });
}

export function closeBehaviorMenuItem(window: BrowserWindow): { label: string; click: () => Promise<void> } {
    const text = platformBehavior().closeBehaviorText;
    return {
        label: text.settingsMenuLabel,
        async click() {
            const choice = await askCloseBehavior(window, text.settings, false);
            if (choice) preferences.set('closeBehavior', choice.behavior);
        },
    };
}
