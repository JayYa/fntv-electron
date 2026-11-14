// 启动同步后插件能力不满足 requires 时，托盘“设置”子菜单显示状态、日志记 ERROR（#224）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');
const { writeArchive, tempRoot } = require('./helpers/mpvManifestFixture.cjs');

const STATUS_PREFIX = 'MPV 插件需要更新';
const FILES = { 'mpv.conf': 'include="~~/fntv/defaults.conf"\n', 'scripts/smart_skip/main.lua': 'skip' };

// 未打包的应用：便携配置在 <appPath>/third_party/fntv-mpv/portable_config，用户配置由 MPV_HOME 指到临时目录。
function setup(t) {
    const testRoot = tempRoot(t, 'tray-caps');
    const paths = { home: testRoot, appData: path.join(testRoot, 'AppData'), userData: path.join(testRoot, '.fntv') };
    fs.mkdirSync(paths.userData, { recursive: true });
    const menus = [];
    const emptyImage = { isEmpty: () => true, resize() { return this; }, setTemplateImage() {} };
    useFakeElectron(t, {
        app: {
            isPackaged: false,
            getAppPath: () => testRoot,
            getPath: (name) => paths[name],
            setPath(name, value) { paths[name] = value; },
            commandLine: { getSwitchValue: () => '' },
            getVersion: () => '0.0.0',
        },
        Tray: class { setToolTip() {} on() {} setContextMenu(menu) { menus.push(menu); } destroy() {} },
        Menu: { buildFromTemplate: (template) => template },
        nativeImage: { createFromPath: () => emptyImage, createEmpty: () => emptyImage },
        dialog: {},
        shell: {},
    }, { platform: 'win32' });
    const originalMpvHome = process.env.MPV_HOME;
    process.env.MPV_HOME = path.join(testRoot, 'mpv-home');
    t.after(() => {
        if (originalMpvHome === undefined) delete process.env.MPV_HOME;
        else process.env.MPV_HOME = originalMpvHome;
    });

    return {
        // 模拟一次启动：装好这个归档，跑 MPV 配置插件，再建托盘。
        async start(provides) {
            fs.rmSync(path.join(testRoot, 'third_party'), { recursive: true, force: true });
            writeArchive(path.join(testRoot, 'third_party'), 'fntv-mpv', { files: FILES, provides });
            require('../dest/main/handlers/plugins/mpvConfig.js').init();
            await require('../dest/main/common/tray.js').createTray({});
        },
        settingsLabels: () => menus.at(-1).find((item) => item.label === '设置').submenu.map((item) => item.label),
        logText: () => fs.readFileSync(path.join(testRoot, 'log', 'app.log'), 'utf8'),
    };
}

test('plugins that miss a required capability show a status in the tray and log the missing capability', async (t) => {
    const app = setup(t);
    await app.start({});

    const status = app.settingsLabels().filter((label) => label?.startsWith(STATUS_PREFIX));
    assert.equal(status.length, 1);
    assert.match(app.logText(), /ERROR.*smart-skip\.origin-from-play-url.*需要 1.*未提供/);
});

test('the status disappears once the installed plugins provide every required capability', async (t) => {
    const app = setup(t);
    await app.start({ 'smart-skip.origin-from-play-url': 0 });
    assert.ok(app.settingsLabels().some((label) => label?.startsWith(STATUS_PREFIX)));
    assert.match(app.logText(), /ERROR.*smart-skip\.origin-from-play-url.*需要 1.*当前 0/);

    await app.start({ 'smart-skip.origin-from-play-url': 1 });
    assert.ok(!app.settingsLabels().some((label) => label?.startsWith(STATUS_PREFIX)));
});
