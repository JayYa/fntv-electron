const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');
const { bindTaskbarProgress } = require('../dest/main/common/taskbarProgress.js');

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

function setupTray(t) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-tray-progress-'));
    const mpvHome = path.join(testRoot, 'mpv-home');
    fs.mkdirSync(mpvHome);
    const paths = { home: testRoot, appData: path.join(testRoot, 'AppData'), userData: path.join(testRoot, '.fntv') };
    fs.mkdirSync(paths.userData, { recursive: true });

    const menus = [];
    class FakeTray {
        setToolTip() {}
        on() {}
        setContextMenu(menu) { menus.push(menu); }
        destroy() {}
    }
    const emptyImage = { isEmpty: () => true, resize() { return this; }, setTemplateImage() {} };
    useFakeElectron(t, {
        app: {
            isPackaged: false,
            getAppPath() { return testRoot; },
            getPath(name) { return paths[name]; },
            setPath(name, value) { paths[name] = value; },
            commandLine: { getSwitchValue() { return ''; } },
            getVersion() { return '0.0.0'; },
        },
        Tray: FakeTray,
        Menu: { buildFromTemplate: (template) => template },
        nativeImage: { createFromPath: () => emptyImage, createEmpty: () => emptyImage },
        dialog: {},
        shell: {},
    });
    const originalMpvHome = process.env.MPV_HOME;
    process.env.MPV_HOME = mpvHome;
    t.after(() => {
        if (originalMpvHome === undefined) delete process.env.MPV_HOME;
        else process.env.MPV_HOME = originalMpvHome;
        fs.rmSync(testRoot, { recursive: true, force: true });
    });

    const progress = fakeDownloadProgress();
    require('../dest/modules/updater/updateChecker.js').getInstance().downloadProgress = progress;

    const checkForUpdatesItem = () => {
        const found = menus.at(-1).find((item) => item.label?.startsWith('检查更新'));
        assert.ok(found, '托盘菜单里没有「检查更新」项');
        return found;
    };
    const setProgressAndWaitForMenu = async (percent) => {
        const count = menus.length;
        progress.set(percent);
        for (let i = 0; i < 100 && menus.length === count; i++) {
            await new Promise((resolve) => setImmediate(resolve));
        }
        assert.ok(menus.length > count, '下载进度变化后托盘菜单没有刷新');
    };

    return {
        async createTray() {
            await require('../dest/main/common/tray.js').createTray({});
        },
        checkForUpdatesItem,
        setProgressAndWaitForMenu,
    };
}

test('the tray check-for-updates item shows the download percent while an update downloads', async (t) => {
    const tray = setupTray(t);
    await tray.createTray();
    assert.equal(tray.checkForUpdatesItem().label, '检查更新');

    await tray.setProgressAndWaitForMenu(0);
    assert.equal(tray.checkForUpdatesItem().label, '检查更新（正在下载新版本 0%）');

    await tray.setProgressAndWaitForMenu(42);
    assert.equal(tray.checkForUpdatesItem().label, '检查更新（正在下载新版本 42%）');

    await tray.setProgressAndWaitForMenu(null);
    assert.equal(tray.checkForUpdatesItem().label, '检查更新');
});

function fakeWindow() {
    const progressBarValues = [];
    let destroyed = false;
    return {
        progressBarValues,
        destroy() { destroyed = true; },
        isDestroyed: () => destroyed,
        setProgressBar(value) { progressBarValues.push(value); },
    };
}

test('the taskbar progress bar follows the download percent and clears when the download ends', () => {
    const window = fakeWindow();
    const progress = fakeDownloadProgress();
    bindTaskbarProgress(window, progress);

    progress.set(0);
    progress.set(42);
    progress.set(100);
    progress.set(null);
    assert.deepEqual(window.progressBarValues, [0, 0.42, 1, -1]);
});

test('the taskbar progress bar is left alone once the main window is destroyed', () => {
    const window = fakeWindow();
    const progress = fakeDownloadProgress();
    bindTaskbarProgress(window, progress);

    window.destroy();
    progress.set(42);
    progress.set(null);
    assert.deepEqual(window.progressBarValues, []);
});
