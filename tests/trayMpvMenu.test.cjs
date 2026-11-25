const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { useFakeElectron, useFakeModule } = require('./helpers/fakeElectron.cjs');

const BUNDLED = { path: 'C:\\app\\third_party\\fntv-mpv\\mpv.exe', bundled: true, args: [] };

function setupTray(t, { mpvHomeExists = true, openPathError = '', userConfigUnknown = false, mpvFound = true, capabilitiesSatisfied = true } = {}) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-tray-'));
    const mpvHome = path.join(testRoot, 'mpv-home');
    if (mpvHomeExists) fs.mkdirSync(mpvHome);
    const paths = { home: testRoot, appData: path.join(testRoot, 'AppData'), userData: path.join(testRoot, '.fntv') };
    fs.mkdirSync(paths.userData, { recursive: true });

    const menus = [];
    const messageBoxes = [];
    const errorBoxes = [];
    const openedPaths = [];
    const openDialogResults = [];
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
        dialog: {
            async showMessageBox(window, options) { messageBoxes.push(options); return { response: 0 }; },
            showErrorBox(title, content) { errorBoxes.push({ title, content }); },
            async showOpenDialog() { return openDialogResults.shift() ?? { canceled: true, filePaths: [] }; },
        },
        shell: {
            async openPath(target) { openedPaths.push(target); return openPathError; },
        },
    }, { platform: 'win32' });

    const config = () => require('../dest/modules/fn_config/settings.js');
    const runtime = {
        pendingUpdates: 0,
        listeners: [],
        stopped: false,
        program() {
            const userPath = config().getMpvPlayerPath();
            if (userPath) return { path: userPath, bundled: false, args: [] };
            return mpvFound ? BUNDLED : undefined;
        },
        userConfig: () => (userConfigUnknown ? undefined : { dir: mpvHome, pendingUpdates: runtime.pendingUpdates }),
        capabilitiesSatisfied: () => capabilitiesSatisfied,
        onPendingUpdatesChange(listener) { runtime.listeners.push(listener); },
        stop() { runtime.stopped = true; },
    };
    useFakeModule(t, './mpvRuntime', { mpvRuntime: runtime });

    let trayModule;
    t.after(() => {
        trayModule?.destroyTray();
        fs.rmSync(testRoot, { recursive: true, force: true });
    });

    const settingsItems = () => menus.at(-1).find((item) => item.label === '设置').submenu;
    const item = (prefix) => {
        const found = settingsItems().find((entry) => entry.label?.startsWith(prefix));
        assert.ok(found, `菜单里没有以“${prefix}”开头的项`);
        return found;
    };
    const waitForMenuAfter = async (count) => {
        for (let i = 0; i < 100 && menus.length === count; i++) {
            await new Promise((resolve) => setImmediate(resolve));
        }
        assert.ok(menus.length > count, '托盘菜单没有刷新');
    };

    return {
        mpvHome,
        runtime,
        messageBoxes,
        errorBoxes,
        openedPaths,
        openDialogResults,
        config,
        async createTray() {
            trayModule = require('../dest/main/common/tray.js');
            await trayModule.createTray({});
        },
        destroyTray: () => trayModule.destroyTray(),
        settingsItems,
        item,
        async clickAndWaitForMenu(prefix) {
            const count = menus.length;
            await item(prefix).click();
            await waitForMenuAfter(count);
        },
        async changePendingUpdates(pendingUpdates) {
            runtime.pendingUpdates = pendingUpdates;
            const count = menus.length;
            runtime.listeners.forEach((listener) => listener());
            await waitForMenuAfter(count);
        },
        logText: () => fs.readFileSync(path.join(testRoot, 'log', 'app.log'), 'utf8'),
    };
}

const PLAYER_ITEM = '设置 MPV 播放器路径';
const CONFIG_ITEM = '打开 MPV 用户配置目录';

test('the tray shows the user-chosen MPV path', async (t) => {
    const tray = setupTray(t);
    tray.config().setMpvPlayerPath('E:\\tools\\mpv\\mpv.exe');
    await tray.createTray();
    assert.equal(tray.item(PLAYER_ITEM).label, `${PLAYER_ITEM} (E:\\tools\\mpv\\mpv.exe)`);
});

test('without a user-chosen MPV the tray shows the program the MPV runtime starts', async (t) => {
    const tray = setupTray(t);
    await tray.createTray();
    assert.equal(tray.item(PLAYER_ITEM).label, `${PLAYER_ITEM} (${BUNDLED.path})`);
});

test('the tray says no MPV was found, without an error dialog', async (t) => {
    const tray = setupTray(t, { mpvFound: false });
    await tray.createTray();
    assert.equal(tray.item(PLAYER_ITEM).label, `${PLAYER_ITEM} (未找到)`);
    assert.deepEqual(tray.errorBoxes, []);
});

test('choosing and clearing the MPV path updates the path shown in the tray', async (t) => {
    const tray = setupTray(t);
    await tray.createTray();
    const bundledLabel = tray.item(PLAYER_ITEM).label;

    tray.openDialogResults.push({ canceled: false, filePaths: ['E:\\tools\\mpv\\mpv.exe'] });
    await tray.clickAndWaitForMenu(PLAYER_ITEM);
    assert.equal(tray.item(PLAYER_ITEM).label, `${PLAYER_ITEM} (E:\\tools\\mpv\\mpv.exe)`);

    await tray.clickAndWaitForMenu('清空 MPV 播放器路径');
    assert.equal(tray.item(PLAYER_ITEM).label, bundledLabel);
});

test('the tray shows the MPV config folder and opens it on click', async (t) => {
    const tray = setupTray(t);
    await tray.createTray();
    const configItem = tray.item(CONFIG_ITEM);
    assert.equal(configItem.label, `${CONFIG_ITEM} (${tray.mpvHome})`);

    await configItem.click();
    assert.deepEqual(tray.openedPaths, [tray.mpvHome]);
    assert.deepEqual(tray.messageBoxes, []);
    assert.deepEqual(tray.errorBoxes, []);
});

test('a missing MPV config folder is explained instead of opened or created', async (t) => {
    const tray = setupTray(t, { mpvHomeExists: false });
    await tray.createTray();
    await tray.item(CONFIG_ITEM).click();

    assert.deepEqual(tray.openedPaths, []);
    assert.equal(fs.existsSync(tray.mpvHome), false);
    assert.equal(tray.messageBoxes.length, 1);
    assert.match(tray.messageBoxes[0].message, /尚不存在/);
    assert.ok(tray.messageBoxes[0].detail.includes(tray.mpvHome));
});

test('a failure to open the MPV config folder shows the reason and is logged', async (t) => {
    const tray = setupTray(t, { openPathError: 'Access is denied.' });
    await tray.createTray();
    await tray.item(CONFIG_ITEM).click();

    assert.equal(tray.errorBoxes.length, 1);
    assert.ok(tray.errorBoxes[0].content.includes('Access is denied.'));
    assert.ok(tray.errorBoxes[0].content.includes(tray.mpvHome));
    assert.match(tray.logText(), /ERROR.*打开 MPV 用户配置目录失败.*Access is denied\./);
});

test('when the MPV config folder is unknown the tray still opens and says so', async (t) => {
    const tray = setupTray(t, { userConfigUnknown: true });
    await tray.createTray();

    const configItem = tray.item(CONFIG_ITEM);
    assert.equal(configItem.label, `${CONFIG_ITEM} (无法确定)`);
    assert.equal(configItem.enabled, false);
});

const PENDING_ITEM = 'MPV 配置有';
const pendingItem = (tray) => tray.settingsItems().find((entry) => entry.label?.startsWith(PENDING_ITEM));

test('the tray shows how many MPV config updates are pending and opens the config folder on click', async (t) => {
    const tray = setupTray(t);
    tray.runtime.pendingUpdates = 2;
    await tray.createTray();

    const item = pendingItem(tray);
    assert.equal(item?.label, 'MPV 配置有 2 个待合并的更新');
    await item.click();
    assert.deepEqual(tray.openedPaths, [tray.mpvHome]);
});

test('the pending-updates item follows the MPV runtime when pending updates change', async (t) => {
    const tray = setupTray(t);
    tray.runtime.pendingUpdates = 1;
    await tray.createTray();
    assert.equal(pendingItem(tray)?.label, 'MPV 配置有 1 个待合并的更新');

    await tray.changePendingUpdates(0);
    assert.equal(pendingItem(tray), undefined);
});

test('the tray shows no pending-updates item without pending updates', async (t) => {
    const tray = setupTray(t);
    await tray.createTray();
    assert.equal(pendingItem(tray), undefined);
});

const CAPABILITY_ITEM = 'MPV 插件需要更新';

test('the tray shows a status when the MPV plugins miss a required capability', async (t) => {
    const tray = setupTray(t, { capabilitiesSatisfied: false });
    await tray.createTray();
    const status = tray.settingsItems().filter((entry) => entry.label?.startsWith(CAPABILITY_ITEM));
    assert.equal(status.length, 1);
    assert.equal(status[0].enabled, false);
});

test('the tray shows no capability status when the MPV plugins provide every capability', async (t) => {
    const tray = setupTray(t);
    await tray.createTray();
    assert.ok(!tray.settingsItems().some((entry) => entry.label?.startsWith(CAPABILITY_ITEM)));
});

test('destroying the tray stops the MPV runtime watching for pending updates', async (t) => {
    const tray = setupTray(t);
    await tray.createTray();
    tray.destroyTray();
    assert.equal(tray.runtime.stopped, true);
});
