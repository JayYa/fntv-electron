const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');

// 托盘插件的 before-quit 收尾：退出被拦下时（应用内更新「退出时安装」先停 MPV 再重新退出），
// 托盘图标要留到真正退出才销毁，和 main.ts 的退出收尾一样看 defaultPrevented。
function setupQuit(t) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-tray-quit-'));
    const paths = { home: testRoot, appData: path.join(testRoot, 'AppData'), userData: path.join(testRoot, '.fntv') };
    fs.mkdirSync(paths.userData, { recursive: true });
    t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

    const trays = [];
    class FakeTray {
        constructor() { this.destroyed = false; trays.push(this); }
        setToolTip() {}
        on() {}
        setContextMenu() {}
        destroy() { this.destroyed = true; }
    }
    const emptyImage = { isEmpty: () => true, resize() { return this; }, setTemplateImage() {} };
    const app = Object.assign(new EventEmitter(), {
        isPackaged: false,
        getAppPath() { return testRoot; },
        getPath(name) { return paths[name]; },
        setPath(name, value) { paths[name] = value; },
        commandLine: { getSwitchValue() { return ''; } },
        getVersion() { return '0.0.0'; },
    });
    useFakeElectron(t, {
        app,
        Tray: FakeTray,
        Menu: { buildFromTemplate: (template) => template },
        nativeImage: { createFromPath: () => emptyImage, createEmpty: () => emptyImage },
        dialog: {},
        shell: {},
    });

    const { initAppHooks } = require('../dest/main/handlers/core/appHook.js');
    initAppHooks();
    require('../dest/main/handlers/plugins/tray.js').init();

    return {
        app,
        trays,
        async createTray() {
            await require('../dest/main/common/tray.js').createTray({});
        },
        // 像 Electron 那样发 before-quit：监听器共用一个事件对象，前面的监听器 preventDefault 后面的能看到
        quit() {
            const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
            app.emit('before-quit', event);
            return event;
        },
    };
}

test('quitting destroys the tray icon', async (t) => {
    const quit = setupQuit(t);
    await quit.createTray();
    quit.quit();
    assert.equal(quit.trays.length, 1);
    assert.equal(quit.trays[0].destroyed, true);
    assert.equal(quit.app.isQuiting, true);
});

test('a quit held back for install-on-quit keeps the tray icon until the real quit', async (t) => {
    const quit = setupQuit(t);
    await quit.createTray();
    // 应用内更新「退出时安装」排在最前面拦下第一次退出（src/modules/updater/inAppUpdate.ts）
    let holdBack = true;
    quit.app.prependListener('before-quit', (event) => {
        if (holdBack) event.preventDefault();
    });

    assert.equal(quit.quit().defaultPrevented, true);
    assert.equal(quit.trays[0].destroyed, false, '退出被拦下时托盘图标被提前销毁');
    assert.notEqual(quit.app.isQuiting, true, '退出被拦下时不应标记为正在退出');

    // 停完 MPV 后 quitAndInstall 重新发起退出
    holdBack = false;
    quit.quit();
    assert.equal(quit.trays[0].destroyed, true);
    assert.equal(quit.app.isQuiting, true);
});
