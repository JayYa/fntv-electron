import { app, dialog, Notification, type BrowserWindow } from 'electron';
import * as fnConfig from '../../modules/fn_config/config';
import * as log from '../../modules/logger';
import { isQuitting } from '../../modules/quit/quitCoordinator';
import { platformBehavior } from '../../public/platform';
import type { CloseBehavior, CloseBehaviorDialog, CloseBehaviorSetting } from '../../public/platform/shared';

let mainWindow: BrowserWindow | null = null;
let showTrayBalloon: ((content: string) => void) | null = null;

const STORED_CLOSE_BEHAVIOR = {
    macCloseAction: { hide: 'minimize', quit: 'quit', ask: 'ask' },
    exitMode: { hide: 'minimize', quit: 'direct', ask: 'ask' },
} as const satisfies Record<CloseBehaviorSetting, Record<CloseBehavior, string>>;

const CLOSE_BEHAVIORS: CloseBehavior[] = ['hide', 'quit', 'ask'];

function readCloseBehavior(): CloseBehavior {
    const setting = platformBehavior().closeBehaviorSetting;
    const stored: string = setting === 'macCloseAction' ? fnConfig.getMacCloseAction() : fnConfig.getExitMode();
    return CLOSE_BEHAVIORS.find(behavior => STORED_CLOSE_BEHAVIOR[setting][behavior] === stored) ?? 'ask';
}

function saveCloseBehavior(behavior: CloseBehavior): void {
    if (platformBehavior().closeBehaviorSetting === 'macCloseAction') {
        fnConfig.setMacCloseAction(STORED_CLOSE_BEHAVIOR.macCloseAction[behavior]);
    } else {
        fnConfig.setExitMode(STORED_CLOSE_BEHAVIOR.exitMode[behavior]);
    }
}

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
    if (!notice || fnConfig.getTrayNotificationShown()) return;
    if (notice.shownBy === 'notification') {
        if (Notification.isSupported()) {
            new Notification({ title: '飞牛影视', body: notice.body, silent: false }).show();
        }
    } else {
        if (!showTrayBalloon) return;
        showTrayBalloon(notice.body);
    }
    fnConfig.setTrayNotificationShown(true);
}

function hide(window: BrowserWindow): void {
    window.hide();
    if (platformBehavior().hasDock) app.dock?.hide();
    noticeHidden();
}

async function handleClose(window: BrowserWindow): Promise<void> {
    let behavior = readCloseBehavior();
    if (behavior === 'ask') {
        const choice = await askCloseBehavior(window, platformBehavior().closeBehaviorText.askOnClose, true);
        if (!choice) return;
        if (choice.remember) saveCloseBehavior(choice.behavior);
        behavior = choice.behavior;
    }
    if (behavior === 'hide') {
        hide(window);
    } else {
        app.quit();
    }
}

/** 主窗口创建后调用（macOS 的 activate 重建窗口时再调用）：接管它的 close，之后显示主窗口都指它。 */
export function manageMainWindow(window: BrowserWindow): void {
    mainWindow = window;
    window.on('close', (event) => {
        if (isQuitting()) return;
        event.preventDefault();
        handleClose(window).catch(error => log.error('处理关闭主窗口失败:', error));
    });
}

/** 托盘创建后提供弹托盘气泡的方法，隐藏提示用托盘气泡的平台（Windows）靠它提示。 */
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
            if (choice) saveCloseBehavior(choice.behavior);
        },
    };
}
