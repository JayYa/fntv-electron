const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');
const { fakeMainWindowElectron, fakeDownloadProgress, pressKey } = require('./helpers/fakeMainWindow.cjs');
const { createQuittingApp, startQuitCoordinator } = require('./helpers/fakeQuitApp.cjs');

function setup(t, { platform = 'win32', windowState } = {}) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-main-window-'));
    const paths = { home: testRoot, userData: path.join(testRoot, '.fntv') };
    fs.mkdirSync(paths.userData, { recursive: true });
    if (windowState) fs.writeFileSync(path.join(paths.userData, 'window-state.json'), JSON.stringify(windowState));
    t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

    const events = [];
    const fake = fakeMainWindowElectron(events);
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
    useFakeElectron(t, { ...fake.electron, app, dialog: {}, Notification: {}, shell: {} }, { platform });
    startQuitCoordinator(events);

    const { mainWindow } = require('../dest/main/common/mainWindow.js');
    const progress = fakeDownloadProgress();
    return {
        events,
        created: fake.created,
        mainWindow,
        progress,
        start() {
            mainWindow.start({ showBalloon: () => true, downloadProgress: progress });
            return mainWindow.window();
        },
    };
}

test('the main window is shown once it is ready, maximized again when it was left maximized', (t) => {
    const env = setup(t, { windowState: { bounds: { x: 10, y: 10, width: 1200, height: 900 }, maximized: true } });
    const window = env.start();
    assert.deepEqual(env.events, []);

    window.emit('ready-to-show');

    assert.deepEqual(env.events, ['window maximized', 'window shown']);
    assert.equal(window.options.webPreferences.sandbox, true);
});

test('F11 and the title bar maximize button both toggle between maximized and restored', (t) => {
    const env = setup(t);
    const window = env.start();

    assert.equal(pressKey(window, 'F11').defaultPrevented, true);
    env.mainWindow.toggleMaximized();
    pressKey(window, 'F11');
    assert.equal(pressKey(window, 'F5').defaultPrevented, false);

    assert.deepEqual(env.events, ['window maximized', 'window unmaximized', 'window maximized']);
});

test('the title bar minimize and close buttons act on the main window, and closing follows the close behavior', async (t) => {
    const env = setup(t, { platform: 'linux' });
    const window = env.start();
    window.emit('ready-to-show');
    env.events.length = 0;
    require('../dest/modules/fn_config/preferences.js').set('closeBehavior', 'hide');

    env.mainWindow.minimize();
    env.mainWindow.close();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(env.events, ['window minimized', 'window hidden']);
    assert.equal(window.isDestroyed(), false);
});

test('the main window is created once and every caller gets the same one', (t) => {
    const env = setup(t);
    const window = env.start();

    assert.equal(env.mainWindow.window(), window);
    assert.equal(env.created.length, 1);
    assert.throws(() => env.mainWindow.start({ showBalloon: () => true, downloadProgress: env.progress }), /主窗口已经启动/);
});

test('using the main window before it is started fails at once', (t) => {
    const env = setup(t);

    assert.throws(() => env.mainWindow.window(), /主窗口还没有启动/);
    assert.throws(() => env.mainWindow.show(), /主窗口还没有启动/);
});

test('reloading the web UI leaves a library page alone so the user keeps their place', (t) => {
    const env = setup(t);
    const window = env.start();

    window.webContents.url = 'https://nas.example:5667/v/library/1';
    env.mainWindow.reloadWebUi();
    assert.equal(window.webContents.reloads, 0);

    window.webContents.url = 'https://nas.example:5667/v/movie/1';
    env.mainWindow.reloadWebUi();
    assert.equal(window.webContents.reloads, 1);
});

test('the taskbar progress bar follows the download percent and clears when the download ends', (t) => {
    const env = setup(t);
    const window = env.start();

    for (const percent of [0, 42, 100, null]) env.progress.set(percent);

    assert.deepEqual(window.progressBarValues, [0, 0.42, 1, -1]);
});

test('showing the main window on macOS restores, shows and focuses it and shows the dock icon', (t) => {
    const env = setup(t, { platform: 'darwin' });
    const window = env.start();
    window.minimized = true;

    env.mainWindow.show();

    assert.deepEqual(env.events, ['window restored', 'window shown', 'window focused', 'dock shown']);
});

test('showing the main window on Windows leaves a visible window in place and focuses it', (t) => {
    const env = setup(t);
    const window = env.start();
    window.emit('ready-to-show');
    env.events.length = 0;

    env.mainWindow.show();

    assert.deepEqual(env.events, ['window focused']);
});

test('a Windows session end on the main window is handed to the quit coordinator, which listens only once', (t) => {
    const env = setup(t);
    const window = env.start();

    assert.equal(window.listenerCount('session-end'), 1);
    assert.throws(() => require('../dest/modules/quit/quitCoordinator.js').listenForSystemShutdown(window), /已经在监听系统关机/);
});
