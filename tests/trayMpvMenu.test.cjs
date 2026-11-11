const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');

const LINUX_MPV_LOCATIONS = ['/usr/bin/mpv', '/usr/local/bin/mpv', '/snap/bin/mpv', '/usr/games/mpv', '/opt/mpv/bin/mpv'];

// 用假的 electron 加载 tray.js，截下每次 setContextMenu 收到的菜单模板。
// MPV_HOME 指向临时目录，用户配置目录在三个平台上都落在这里，不碰本机真实的 mpv 配置。
// appDataError 让 app.getPath('appData') 抛这个错，像 Windows 上 USERPROFILE 指向的目录下没有 AppData\Roaming 时那样。
function setupTray(t, { platform, mpvHomeExists = true, openPathError = '', appDataError = '' } = {}) {
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
    const electronMock = {
        app: {
            isPackaged: false,
            getAppPath() { return testRoot; },
            getPath(name) {
                if (name === 'appData' && appDataError) throw new Error(appDataError);
                return paths[name];
            },
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
    };

    useFakeElectron(t, electronMock, { platform });
    const originalMpvHome = process.env.MPV_HOME;
    process.env.MPV_HOME = mpvHome;
    t.after(() => {
        if (originalMpvHome === undefined) delete process.env.MPV_HOME;
        else process.env.MPV_HOME = originalMpvHome;
        fs.rmSync(testRoot, { recursive: true, force: true });
    });

    const settingsItems = () => menus.at(-1).find((item) => item.label === '设置').submenu;
    const item = (prefix) => {
        const found = settingsItems().find((entry) => entry.label?.startsWith(prefix));
        assert.ok(found, `菜单里没有以“${prefix}”开头的项`);
        return found;
    };
    // 菜单项的 click 不等待菜单重建，这里等到下一份菜单出现。
    const clickAndWaitForMenu = async (prefix) => {
        const count = menus.length;
        await item(prefix).click();
        for (let i = 0; i < 100 && menus.length === count; i++) {
            await new Promise((resolve) => setImmediate(resolve));
        }
        assert.ok(menus.length > count, '点击后托盘菜单没有刷新');
    };

    return {
        testRoot,
        mpvHome,
        messageBoxes,
        errorBoxes,
        openedPaths,
        openDialogResults,
        config: () => require('../dest/modules/fn_config/config.js'),
        async createTray() {
            await require('../dest/main/common/tray.js').createTray({});
        },
        item,
        clickAndWaitForMenu,
        logText: () => fs.readFileSync(path.join(testRoot, 'log', 'app.log'), 'utf8'),
    };
}

const PLAYER_ITEM = '设置MPV播放器路径';
const CONFIG_ITEM = '打开MPV用户配置目录';

test('the tray shows the user-chosen MPV path', async (t) => {
    const tray = setupTray(t);
    tray.config().setMpvPlayerPath('E:\\tools\\mpv\\mpv.exe');
    await tray.createTray();
    assert.equal(tray.item(PLAYER_ITEM).label, `${PLAYER_ITEM} (E:\\tools\\mpv\\mpv.exe)`);
});

test('on Windows without a user-chosen MPV the tray shows the bundled MPV path', async (t) => {
    const tray = setupTray(t, { platform: 'win32' });
    await tray.createTray();
    const bundled = path.join(tray.testRoot, 'third_party', 'fntv-mpv', 'mpv.exe');
    assert.equal(tray.item(PLAYER_ITEM).label, `${PLAYER_ITEM} (${bundled})`);
});

const hostHasLinuxMpv = LINUX_MPV_LOCATIONS.some((location) => fs.existsSync(location));
test('on Linux the tray says no mpv was found, without an error dialog', { skip: hostHasLinuxMpv && 'this host has mpv installed in a known location' }, async (t) => {
    const tray = setupTray(t, { platform: 'linux' });
    await tray.createTray();
    assert.equal(tray.item(PLAYER_ITEM).label, `${PLAYER_ITEM} (未找到)`);
    assert.deepEqual(tray.errorBoxes, []);
});

test('choosing and clearing the MPV path updates the path shown in the tray', async (t) => {
    const tray = setupTray(t, { platform: 'win32' });
    await tray.createTray();
    const bundledLabel = tray.item(PLAYER_ITEM).label;

    tray.openDialogResults.push({ canceled: false, filePaths: ['E:\\tools\\mpv\\mpv.exe'] });
    await tray.clickAndWaitForMenu(PLAYER_ITEM);
    assert.equal(tray.item(PLAYER_ITEM).label, `${PLAYER_ITEM} (E:\\tools\\mpv\\mpv.exe)`);

    await tray.clickAndWaitForMenu('清空MPV播放器路径');
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
    assert.match(tray.logText(), /ERROR.*打开MPV用户配置目录失败.*Access is denied\./);
});

test('when the MPV config folder cannot be determined the tray still opens and says so', async (t) => {
    const tray = setupTray(t, { appDataError: "Failed to get 'appData' path" });
    await tray.createTray();

    const configItem = tray.item(CONFIG_ITEM);
    assert.equal(configItem.label, `${CONFIG_ITEM} (无法确定)`);
    assert.equal(configItem.enabled, false);
    assert.match(tray.logText(), /获取MPV用户配置目录失败.*Failed to get 'appData' path/);
});
