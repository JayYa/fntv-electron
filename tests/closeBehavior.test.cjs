const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');
const { settle, waitFor } = require('./helpers/updateChecker.cjs');
const { createQuittingApp, deferred, startPlaying, startQuitCoordinator } = require('./helpers/fakeQuitApp.cjs');
const { fakeDownloadProgress, fakeMainWindowElectron } = require('./helpers/fakeMainWindow.cjs');

function clickClose(window) {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    window.emit('close', event);
    return event;
}

function setup(t, { platform, config, trayReady = true } = {}) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-close-'));
    const paths = { home: testRoot, userData: path.join(testRoot, '.fntv') };
    fs.mkdirSync(paths.userData, { recursive: true });
    if (config) fs.writeFileSync(path.join(paths.userData, 'config.json'), JSON.stringify(config));
    t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

    const events = [];
    const dialogs = [];
    const answers = [];
    const app = createQuittingApp(events, {
        isPackaged: false,
        getAppPath() { return testRoot; },
        getPath(name) { return paths[name]; },
        setPath(name, value) { paths[name] = value; },
        commandLine: { getSwitchValue() { return ''; } },
        getVersion() { return '0.0.0'; },
        dock: {
            hide() { events.push('dock hidden'); },
            show() { events.push('dock shown'); },
        },
    });
    class Notification {
        static isSupported() { return true; }
        constructor(options) { this.options = options; }
        show() { events.push(`notification: ${this.options.body}`); }
    }
    const dialog = {
        async showMessageBox(_window, options) {
            dialogs.push(options);
            const answer = answers.shift();
            assert.ok(answer, `没有排好回答的弹窗: ${options.title}`);
            const response = options.buttons.indexOf(answer.click);
            assert.notEqual(response, -1, `弹窗「${options.title}」没有按钮「${answer.click}」: ${options.buttons.join('、')}`);
            return { response, checkboxChecked: answer.remember === true };
        },
    };
    useFakeElectron(t, { ...fakeMainWindowElectron(events).electron, app, dialog, Notification, shell: {} }, { platform });

    startQuitCoordinator(events);
    const { mainWindow } = require('../dest/main/common/mainWindow.js');
    const showBalloon = (content) => {
        if (!trayReady) return false;
        events.push(`balloon: ${content}`);
        return true;
    };
    mainWindow.start({ showBalloon, downloadProgress: fakeDownloadProgress() });
    const window = mainWindow.window();
    window.emit('ready-to-show');
    events.length = 0;
    return {
        app, events, window, mainWindow, dialogs,
        answer(click, { remember = false } = {}) { answers.push({ click, remember }); },
    };
}

test('on Windows closing with the default setting asks, and minimizing hides the window with a one-time balloon', async (t) => {
    const env = setup(t, { platform: 'win32' });

    env.answer('最小化到托盘');
    assert.equal(clickClose(env.window).defaultPrevented, true);
    await settle();
    env.answer('最小化到托盘');
    clickClose(env.window);
    await settle();

    assert.equal(env.dialogs.length, 2, '没记住选择，每次关闭都要问');
    assert.equal(env.dialogs[0].title, '退出确认');
    assert.deepEqual(env.events, [
        'window hidden',
        'balloon: 应用已最小化到托盘，双击托盘图标或右键菜单可以恢复窗口',
        'window hidden',
    ]);
    assert.equal(env.app.exited, false);
});

test('hiding the window before the tray exists keeps the one-time balloon for the next hide', async (t) => {
    const env = setup(t, { platform: 'win32', config: { exitMode: 'minimize' }, trayReady: false });

    clickClose(env.window);
    await settle();

    assert.equal(require('../dest/modules/fn_config/clientState.js').trayNotificationShown(), false);
});

test('on Windows choosing quit with remember quits, and the next start quits on close without asking', async (t) => {
    const env = setup(t, { platform: 'win32' });

    env.answer('退出应用', { remember: true });
    clickClose(env.window);
    await waitFor(() => env.app.exited);
    assert.equal(clickClose(env.window).defaultPrevented, false);
    assert.equal(env.dialogs.length, 1);

    const saved = JSON.parse(fs.readFileSync(path.join(env.app.getPath('userData'), 'config.json'), 'utf8'));
    assert.equal(saved.exitMode, 'direct', '已有配置的键名和取值要保持不变');
});

test('closing the window again while the quit waits for the progress report closes it without asking', async (t) => {
    const env = setup(t, { platform: 'win32' });
    const playback = require('../dest/modules/playback/playbackState.js');
    const report = deferred();
    startPlaying(playback, env.events, report.promise);

    env.answer('退出应用');
    clickClose(env.window);
    await settle();
    assert.equal(env.app.exited, false, '进度回传完成前不该退出');

    assert.equal(clickClose(env.window).defaultPrevented, false);
    await settle();
    assert.equal(env.dialogs.length, 1, '退出收尾期间不再询问');

    report.resolve();
    await waitFor(() => env.app.exited);
});

test('an existing exitMode of minimize hides on close without asking', async (t) => {
    const env = setup(t, { platform: 'linux', config: { exitMode: 'minimize' } });

    assert.equal(clickClose(env.window).defaultPrevented, true);
    await settle();

    assert.equal(env.dialogs.length, 0);
    assert.deepEqual(env.events, ['window hidden']);
});

test('cancelling the close dialog leaves the window open', async (t) => {
    const env = setup(t, { platform: 'win32' });

    env.answer('取消', { remember: true });
    clickClose(env.window);
    await settle();

    assert.deepEqual(env.events, []);
    env.answer('取消');
    clickClose(env.window);
    await settle();
    assert.equal(env.dialogs.length, 2, '取消时勾了记住也不记');
});

test('on macOS hiding also hides the dock icon and notifies once', async (t) => {
    const env = setup(t, { platform: 'darwin' });

    env.answer('隐藏到状态栏', { remember: true });
    clickClose(env.window);
    await settle();
    clickClose(env.window);
    await settle();

    assert.equal(env.dialogs.length, 1);
    assert.equal(env.dialogs[0].title, '关闭窗口');
    assert.deepEqual(env.events, [
        'window hidden',
        'dock hidden',
        'notification: 应用已隐藏到状态栏，点击状态栏图标可以恢复窗口',
        'window hidden',
        'dock hidden',
    ]);
});

test('an existing macCloseAction of quit quits on close without asking', async (t) => {
    const env = setup(t, { platform: 'darwin', config: { macCloseAction: 'quit' } });

    clickClose(env.window);
    await waitFor(() => env.app.exited);

    assert.equal(env.dialogs.length, 0);
});

test('an unrecognized stored close behavior asks on close', async (t) => {
    const env = setup(t, { platform: 'darwin', config: { macCloseAction: 'bogus' } });

    env.answer('取消');
    clickClose(env.window);
    await settle();

    assert.equal(env.dialogs.length, 1);
    assert.equal(env.app.exited, false);
});

test('the close behavior settings dialog changes what closing does', async (t) => {
    const env = setup(t, { platform: 'win32', config: { exitMode: 'minimize' } });

    const item = env.mainWindow.closeBehaviorMenuItem();
    assert.equal(item.label, '退出行为设置');
    env.answer('直接退出');
    await item.click();
    clickClose(env.window);
    await waitFor(() => env.app.exited);

    assert.equal(env.dialogs.length, 1);
    assert.equal(env.dialogs[0].title, '退出行为设置');
});

test('on macOS the close behavior settings dialog can switch back to asking', async (t) => {
    const env = setup(t, { platform: 'darwin', config: { macCloseAction: 'minimize' } });

    const item = env.mainWindow.closeBehaviorMenuItem();
    assert.equal(item.label, '关闭行为设置');
    env.answer('每次询问');
    await item.click();
    env.answer('取消');
    clickClose(env.window);
    await settle();

    assert.equal(env.dialogs.length, 2);
    assert.equal(env.dialogs[1].title, '关闭窗口');
});
