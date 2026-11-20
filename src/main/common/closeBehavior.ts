import { app, dialog, Notification, type BrowserWindow } from 'electron';
import * as fnConfig from '../../modules/fn_config/config';
import * as log from '../../modules/logger';
import { isQuitting } from '../../modules/quit/quitCoordinator';
import { platformBehavior } from '../../public/platform';
import type { CloseBehavior, CloseBehaviorDialog } from '../../public/platform/shared';

/**
 * 关闭行为（GLOSSARY.md）：主窗口的 close 只在这里处理，托盘的「关闭行为设置」「显示主窗口」也在这里。
 * 退出开始后（退出协调，src/modules/quit/quitCoordinator.ts）close 不再拦下，窗口照常关闭。
 */

let mainWindow: BrowserWindow | null = null;
let showTrayBalloon: ((content: string) => void) | null = null;

// 配置文件里沿用原来的键名和取值，兼容已有配置
function readCloseBehavior(): CloseBehavior {
    if (platformBehavior().closeBehaviorSetting === 'macCloseAction') {
        const action = fnConfig.getMacCloseAction();
        return action === 'minimize' ? 'hide' : action;
    }
    const mode = fnConfig.getExitMode();
    return mode === 'minimize' ? 'hide' : mode === 'ask' ? 'ask' : 'quit';
}

function saveCloseBehavior(behavior: CloseBehavior): void {
    if (platformBehavior().closeBehaviorSetting === 'macCloseAction') {
        fnConfig.setMacCloseAction(behavior === 'hide' ? 'minimize' : behavior);
    } else {
        fnConfig.setExitMode(behavior === 'hide' ? 'minimize' : behavior === 'quit' ? 'direct' : 'ask');
    }
}

/** 弹出关闭行为的弹窗，返回选中的关闭行为；取消时为 null */
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

// 第一次隐藏时提示窗口去了哪里，之后不再提示
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
    // macCloseAction 被改成认不出的值时什么都不做，和原来一样
    if (behavior === 'hide') {
        hide(window);
    } else if (behavior === 'quit') {
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

/** 恢复、显示并聚焦主窗口；有 dock 的平台同时显示 dock 图标。 */
export function showMainWindow(): void {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    if (platformBehavior().hasDock) app.dock?.show();
}

/** 托盘菜单里改关闭行为的菜单项。 */
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
