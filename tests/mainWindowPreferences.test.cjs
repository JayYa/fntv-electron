const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');
const { openLoginPage } = require('./helpers/loginPage.cjs');
const { fakeDownloadProgress, fakeMainWindowElectron } = require('./helpers/fakeMainWindow.cjs');

function setup(t, storedConfig, { url } = {}) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-login-page-preferences-'));
    const paths = { home: testRoot, userData: path.join(testRoot, '.fntv') };
    const ipcMain = new EventEmitter();
    ipcMain.invokeHandlers = new Map();
    ipcMain.handle = (channel, handler) => ipcMain.invokeHandlers.set(channel, handler);
    useFakeElectron(t, {
        ...fakeMainWindowElectron([]).electron,
        ipcMain,
        app: {
            isPackaged: false,
            getAppPath() { return testRoot; },
            getPath(name) { return paths[name]; },
            commandLine: { getSwitchValue() { return ''; } },
            setPath(name, value) { paths[name] = value; },
        },
        safeStorage: {},
    });
    t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
    fs.mkdirSync(paths.userData, { recursive: true });
    fs.writeFileSync(path.join(paths.userData, 'config.json'), JSON.stringify(storedConfig));

    const preferences = require('../dest/modules/fn_config/preferences.js');
    require('../dest/main/handlers/plugins/config.js').init();
    const { LOGIN_PAGE_PATH } = require('../dest/main/common/loginPage.js');

    const page = openLoginPage();
    const { mainWindow } = require('../dest/main/common/mainWindow.js');
    mainWindow.start({ showBalloon() {}, downloadProgress: fakeDownloadProgress() });
    const window = mainWindow.window();
    window.webContents.url = url ?? pathToFileURL(LOGIN_PAGE_PATH).href;
    window.webContents.send = (channel, data) => page.receive(channel, data);

    let delivered = 0;
    const deliverSent = () => {
        while (delivered < page.sent.length) {
            const { channel, payload } = page.sent[delivered];
            delivered += 1;
            if (ipcMain.listenerCount(channel) > 0) {
                ipcMain.emit(channel, { reply: (replyChannel, data) => page.receive(replyChannel, data) }, payload);
            }
        }
    };
    page.load();
    deliverSent();

    return {
        preferences,
        page,
        window,
        switchOf: (id) => page.input(id).checked,
        openPanel: () => page.click('proxySettingsBtn'),
        async save() {
            page.click('proxySaveBtn');
            for (const { channel, payload } of page.pending()) {
                await page.resolve(channel, await ipcMain.invokeHandlers.get(channel)({}, payload));
            }
            deliverSent();
        },
    };
}

const STORED = { downloadProxyEnabled: false, downloadProxy: 'https://relay.example.test/', hideOriginalPlayButton: true };

test('a preference changed in the tray while the login page is open shows up in its settings panel', (t) => {
    const { preferences, switchOf } = setup(t, STORED);
    assert.equal(switchOf('mpvPlaybackSwitch'), true);

    preferences.set('mpvPlayback', false);

    assert.equal(switchOf('mpvPlaybackSwitch'), false);
});

test('saving the app download proxy on the login page keeps a MPV playback change made in the tray', async (t) => {
    const { preferences, page, openPanel, save } = setup(t, STORED);

    preferences.set('mpvPlayback', false);
    openPanel();
    page.input('proxyEnabledSwitch').checked = true;
    await save();

    assert.equal(preferences.get('mpvPlayback'), false);
    assert.deepEqual(preferences.get('appDownloadProxy'), { enabled: true, proxyUrl: 'https://relay.example.test/' });
    assert.equal(page.input('proxyPanel').classList.contains('show'), false);
});

test('a tray change arriving while the user edits the panel leaves the edited setting as the user typed it', async (t) => {
    const { preferences, page, openPanel, save } = setup(t, STORED);

    openPanel();
    page.input('proxyUrlInput').value = 'https://typed.example.test/';
    preferences.set('appDownloadProxy', { enabled: true, proxyUrl: 'https://relay.example.test/' });

    assert.equal(page.input('proxyUrlInput').value, 'https://typed.example.test/');
    assert.equal(page.input('proxyEnabledSwitch').checked, true);

    await save();
    assert.deepEqual(preferences.get('appDownloadProxy'), { enabled: true, proxyUrl: 'https://typed.example.test/' });
});

test('saving the panel without changes sends nothing and closes it', async (t) => {
    const { page, openPanel } = setup(t, STORED);

    openPanel();
    page.click('proxySaveBtn');

    assert.deepEqual(page.pending(), []);
    assert.equal(page.input('proxyPanel').classList.contains('show'), false);
});

test('turning the MPV playback preference on or off reloads the web UI so takeover follows it', (t) => {
    const { preferences, window } = setup(t, STORED, { url: 'https://nas.example:5667/v/movie/1' });

    preferences.set('mpvPlayback', false);
    preferences.set('mpvPlayback', false);
    preferences.set('nasLocalProxy', true);
    assert.equal(window.webContents.reloads, 1);

    preferences.set('mpvPlayback', true);
    assert.equal(window.webContents.reloads, 2);
});

test('changing the MPV playback preference on the login page does not reload the login page', (t) => {
    const { preferences, window } = setup(t, STORED);

    preferences.set('mpvPlayback', false);

    assert.equal(window.webContents.reloads, 0);
});

test('with no saved MPV playback preference the login page shows MPV playback turned on', (t) => {
    const { switchOf } = setup(t, {});

    assert.equal(switchOf('mpvPlaybackSwitch'), true);
});
