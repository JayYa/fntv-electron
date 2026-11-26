const { EventEmitter } = require('node:events');
const { useFakeModule } = require('./fakeElectron.cjs');

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1040 };

function fakeWebContents() {
    return Object.assign(new EventEmitter(), {
        url: '',
        sent: [],
        reloads: 0,
        getURL() { return this.url; },
        send(channel, data) { this.sent.push({ channel, data }); },
        reloadIgnoringCache() { this.reloads += 1; },
    });
}

function fakeBrowserWindowClass(events, created) {
    return class FakeBrowserWindow extends EventEmitter {
        constructor(options) {
            super();
            this.options = options;
            this.visible = false;
            this.minimized = false;
            this.maximized = false;
            this.destroyed = false;
            this.progressBarValues = [];
            this.webContents = fakeWebContents();
            created.push(this);
        }

        static getAllWindows() { return created.filter((window) => !window.destroyed); }

        isVisible() { return this.visible; }
        isMinimized() { return this.minimized; }
        isMaximized() { return this.maximized; }
        isFullScreen() { return false; }
        isDestroyed() { return this.destroyed; }
        getNormalBounds() { return { x: 0, y: 0, width: this.options.width, height: this.options.height }; }
        show() { this.visible = true; events.push('window shown'); }
        hide() { this.visible = false; events.push('window hidden'); }
        focus() { events.push('window focused'); }
        restore() { this.minimized = false; events.push('window restored'); }
        minimize() { this.minimized = true; events.push('window minimized'); }
        maximize() { this.maximized = true; events.push('window maximized'); }
        unmaximize() { this.maximized = false; events.push('window unmaximized'); }
        setProgressBar(value) { this.progressBarValues.push(value); }
        close() {
            const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
            this.emit('close', event);
            if (!event.defaultPrevented) this.destroyed = true;
            return event;
        }
    };
}

function fakeMainWindowElectron(events) {
    const created = [];
    return {
        created,
        electron: {
            BrowserWindow: fakeBrowserWindowClass(events, created),
            screen: {
                getAllDisplays: () => [{ workArea: WORK_AREA }],
                getPrimaryDisplay: () => ({ workArea: WORK_AREA }),
            },
            powerMonitor: new EventEmitter(),
        },
    };
}

function fakeDownloadProgress() {
    let current = null;
    const listeners = [];
    return {
        percent: () => current,
        onChange(listener) { listeners.push(listener); },
        set(percent) {
            current = percent;
            listeners.forEach((listener) => listener(percent));
        },
    };
}

function pressKey(window, key) {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    window.webContents.emit('before-input-event', event, { type: 'keyDown', key });
    return event;
}

function useStubMainWindow(t) {
    useFakeModule(t, './mainWindow', {
        mainWindow: {
            window: () => ({}),
            show() {},
            closeBehaviorMenuItem: () => ({ label: '退出行为设置', async click() {} }),
        },
    });
}

function startMainWindow() {
    const { mainWindow } = require('../../dest/main/common/mainWindow.js');
    mainWindow.start({ showBalloon: () => true, downloadProgress: fakeDownloadProgress() });
    return mainWindow.window();
}

module.exports = { fakeMainWindowElectron, fakeDownloadProgress, pressKey, useStubMainWindow, startMainWindow };
