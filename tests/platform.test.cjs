const test = require('node:test');
const assert = require('node:assert/strict');

const {
    currentPlatform,
    platformBehavior,
    proxyExecutablePath,
    mpvUserConfigDir,
} = require('../dest/public/platform.js');

test('platformBehavior defaults to the platform the app runs on', () => {
    assert.deepEqual(platformBehavior(), platformBehavior(currentPlatform()));
    assert.equal(currentPlatform(), process.platform);
});

test('macOS keeps running in the status bar and dock and asks about closing the window', () => {
    const behavior = platformBehavior('darwin');
    assert.equal(behavior.closeBehaviorSetting, 'macCloseAction');
    assert.equal(behavior.quitsWhenAllWindowsClosed, false);
    assert.equal(behavior.hasDock, true);
    assert.equal(behavior.titleBar, 'hiddenInset');
    assert.deepEqual(behavior.tray, {
        showWindowLabel: '显示窗口',
        quitLabel: '退出飞牛影视',
        restoreEvent: 'click',
        icon: { file: 'iconTemplate2.png', template: true },
        showsMinimizeBalloon: false,
    });
    assert.deepEqual(behavior.mpvExecutableExtensions, []);
    assert.equal(behavior.rejectsBasicTextStorage, false);
});

test('Windows minimizes to the tray, restores on double-click and announces it once with a balloon', () => {
    const behavior = platformBehavior('win32');
    assert.equal(behavior.closeBehaviorSetting, 'exitMode');
    assert.equal(behavior.quitsWhenAllWindowsClosed, true);
    assert.equal(behavior.hasDock, false);
    assert.equal(behavior.titleBar, 'frameless');
    assert.deepEqual(behavior.tray, {
        showWindowLabel: '显示主窗口',
        quitLabel: '退出',
        restoreEvent: 'double-click',
        icon: { file: 'icon.ico', template: false },
        showsMinimizeBalloon: true,
    });
    assert.deepEqual(behavior.mpvExecutableExtensions, ['exe']);
    assert.equal(behavior.rejectsBasicTextStorage, false);
});

test('Linux uses the exit mode, binds no tray click and refuses the basic_text credential backend', () => {
    const behavior = platformBehavior('linux');
    assert.equal(behavior.closeBehaviorSetting, 'exitMode');
    assert.equal(behavior.quitsWhenAllWindowsClosed, true);
    assert.equal(behavior.hasDock, false);
    assert.equal(behavior.titleBar, 'frameless');
    assert.deepEqual(behavior.tray, {
        showWindowLabel: '显示主窗口',
        quitLabel: '退出',
        restoreEvent: null,
        icon: { file: 'icon.png', template: false },
        showsMinimizeBalloon: false,
    });
    assert.deepEqual(behavior.mpvExecutableExtensions, []);
    assert.equal(behavior.rejectsBasicTextStorage, true);
});

test('the proxy executable sits next to the working directory on Windows, packaged or not', () => {
    const appPath = 'C:\\Program Files\\飞牛影视\\resources\\app.asar';
    for (const isPackaged of [false, true]) {
        assert.equal(proxyExecutablePath('win32', { isPackaged, appPath }), '.\\third_party\\proxy\\proxy.exe');
    }
});

test('the packaged proxy executable is two levels above app.asar on macOS and Linux', () => {
    assert.equal(
        proxyExecutablePath('darwin', { isPackaged: true, appPath: '/Applications/飞牛影视.app/Contents/Resources/app.asar' }),
        '/Applications/飞牛影视.app/Contents/third_party/proxy/proxy',
    );
    assert.equal(
        proxyExecutablePath('linux', { isPackaged: true, appPath: '/tmp/.mount_FNMedia/resources/app.asar' }),
        '/tmp/.mount_FNMedia/third_party/proxy/proxy',
    );
});

test('the unpackaged proxy executable is relative to the working directory on macOS and Linux', () => {
    for (const platform of ['darwin', 'linux']) {
        assert.equal(proxyExecutablePath(platform, { isPackaged: false, appPath: '/src/fntv' }), './third_party/proxy/proxy');
    }
});

test('the user MPV config lives in AppData on Windows and ~/.config elsewhere', () => {
    assert.equal(mpvUserConfigDir('win32', 'C:\\Users\\me'), 'C:\\Users\\me\\AppData\\Roaming\\mpv');
    assert.equal(mpvUserConfigDir('darwin', '/Users/me'), '/Users/me/.config/mpv');
    assert.equal(mpvUserConfigDir('linux', '/home/me'), '/home/me/.config/mpv');
});
