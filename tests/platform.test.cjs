const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    currentPlatform,
    platformBehavior,
    mpvUserConfigDir,
    mpvIpcSocket,
    mpvPlayer,
    inAppUpdateAvailability,
} = require('../dest/public/platform.js');

test('only a packaged Windows client can update in app', () => {
    assert.deepEqual(inAppUpdateAvailability('win32', true), { available: true });
    for (const [platform, isPackaged] of [['win32', false], ['darwin', true], ['linux', true]]) {
        const result = inAppUpdateAvailability(platform, isPackaged);
        assert.equal(result.available, false, `${platform} packaged=${isPackaged}`);
        assert.ok(result.reason.length > 0);
    }
});

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
    assert.equal(behavior.windowIcon, 'icon.png');
    assert.deepEqual(behavior.tray, {
        showWindowLabel: '显示窗口',
        quitLabel: '退出飞牛影视',
        restoreEvent: 'click',
        icon: { file: 'iconTemplate2.png', template: true },
        showsMinimizeBalloon: false,
    });
    assert.deepEqual(behavior.mpvExecutableExtensions, []);
    assert.equal(behavior.mpvNotFoundMessage, 'macOS平台未找到mpv播放器，请使用Homebrew安装mpv后重试: brew install mpv');
    assert.equal(behavior.rejectsBasicTextStorage, false);
});

test('Windows minimizes to the tray, restores on double-click and announces it once with a balloon', () => {
    const behavior = platformBehavior('win32');
    assert.equal(behavior.closeBehaviorSetting, 'exitMode');
    assert.equal(behavior.quitsWhenAllWindowsClosed, true);
    assert.equal(behavior.hasDock, false);
    assert.equal(behavior.titleBar, 'frameless');
    assert.equal(behavior.windowIcon, 'icon.ico');
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

test('Linux uses the exit mode, a PNG window icon, restores on tray click and refuses the basic_text credential backend', () => {
    const behavior = platformBehavior('linux');
    assert.equal(behavior.closeBehaviorSetting, 'exitMode');
    assert.equal(behavior.quitsWhenAllWindowsClosed, true);
    assert.equal(behavior.hasDock, false);
    assert.equal(behavior.titleBar, 'frameless');
    // Electron 的 nativeImage 只在 Windows 上读 ICO，其它平台读 PNG（#74）。
    assert.equal(behavior.windowIcon, 'icon.png');
    assert.deepEqual(behavior.tray, {
        showWindowLabel: '显示主窗口',
        quitLabel: '退出',
        // Linux 上用户激活托盘图标时发 click，没有 double-click（#75）。
        restoreEvent: 'click',
        icon: { file: 'icon.png', template: false },
        showsMinimizeBalloon: false,
    });
    assert.deepEqual(behavior.mpvExecutableExtensions, []);
    assert.equal(behavior.mpvNotFoundMessage, 'Linux平台未找到mpv播放器，请安装mpv播放器后重试');
    assert.equal(behavior.rejectsBasicTextStorage, true);
});

const windowsDirs = { homeDir: 'C:\\Users\\me', appDataDir: 'D:\\Profiles\\me\\Roaming' };
const macDirs = { homeDir: '/Users/me', appDataDir: '/Users/me/Library/Application Support' };
const linuxDirs = { homeDir: '/home/me', appDataDir: '/home/me/.config' };
const noPaths = () => false;

test('without environment overrides the user MPV config is in the roaming AppData folder on Windows and ~/.config elsewhere', () => {
    assert.equal(mpvUserConfigDir('win32', windowsDirs, {}, undefined, noPaths), 'D:\\Profiles\\me\\Roaming\\mpv');
    assert.equal(mpvUserConfigDir('darwin', macDirs, {}, undefined, noPaths), '/Users/me/.config/mpv');
    assert.equal(mpvUserConfigDir('linux', linuxDirs, {}, undefined, noPaths), '/home/me/.config/mpv');
});

test('macOS and Linux put the user MPV config under XDG_CONFIG_HOME when it is set', () => {
    const env = { XDG_CONFIG_HOME: '/data/config' };
    assert.equal(mpvUserConfigDir('darwin', macDirs, env, undefined, noPaths), '/data/config/mpv');
    assert.equal(mpvUserConfigDir('linux', linuxDirs, env, undefined, noPaths), '/data/config/mpv');
});

test('MPV_HOME is the user MPV config itself and wins over XDG_CONFIG_HOME and AppData', () => {
    assert.equal(mpvUserConfigDir('linux', linuxDirs, { MPV_HOME: '/opt/mpv-home', XDG_CONFIG_HOME: '/data/config' }, undefined, noPaths), '/opt/mpv-home');
    assert.equal(mpvUserConfigDir('darwin', macDirs, { MPV_HOME: '/opt/mpv-home' }, undefined, noPaths), '/opt/mpv-home');
    assert.equal(mpvUserConfigDir('win32', windowsDirs, { MPV_HOME: 'E:\\mpv-home' }, undefined, noPaths), 'E:\\mpv-home');
});

test('a relative XDG_CONFIG_HOME is ignored, as mpv only accepts an absolute one', () => {
    assert.equal(mpvUserConfigDir('linux', linuxDirs, { XDG_CONFIG_HOME: 'config' }, undefined, noPaths), '/home/me/.config/mpv');
});

test('empty MPV_HOME and XDG_CONFIG_HOME count as unset', () => {
    assert.equal(mpvUserConfigDir('linux', linuxDirs, { MPV_HOME: '', XDG_CONFIG_HOME: '' }, undefined, noPaths), '/home/me/.config/mpv');
    assert.equal(mpvUserConfigDir('win32', windowsDirs, { MPV_HOME: '' }, undefined, noPaths), 'D:\\Profiles\\me\\Roaming\\mpv');
});

test('Windows ignores XDG_CONFIG_HOME for the user MPV config', () => {
    assert.equal(mpvUserConfigDir('win32', windowsDirs, { XDG_CONFIG_HOME: 'E:\\xdg' }, undefined, noPaths), 'D:\\Profiles\\me\\Roaming\\mpv');
});

function tempHome(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-mpv-home-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

test('macOS and Linux keep using ~/.mpv when it exists and the standard MPV config does not', t => {
    const home = tempHome(t);
    fs.mkdirSync(path.join(home, '.mpv'));
    for (const platform of ['darwin', 'linux']) {
        assert.equal(mpvUserConfigDir(platform, { homeDir: home, appDataDir: home }, {}, undefined, fs.existsSync), `${home}/.mpv`);
    }
});

test('the standard MPV config wins over ~/.mpv when both exist, and Windows never reads ~/.mpv', t => {
    const home = tempHome(t);
    fs.mkdirSync(path.join(home, '.mpv'));
    fs.mkdirSync(path.join(home, '.config', 'mpv'), { recursive: true });
    assert.equal(mpvUserConfigDir('linux', { homeDir: home, appDataDir: home }, {}, undefined, fs.existsSync), `${home}/.config/mpv`);
    assert.equal(mpvUserConfigDir('win32', windowsDirs, {}, undefined, fs.existsSync), 'D:\\Profiles\\me\\Roaming\\mpv');
});

// Windows 路径要在 Windows 上才能对应到真实目录。
const onWindowsHost = { skip: process.platform !== 'win32' && 'Windows paths only resolve on a Windows host' };

test('a user-chosen mpv.exe with portable_config next to it reads only that folder', onWindowsHost, t => {
    const mpvDir = tempHome(t);
    fs.mkdirSync(path.join(mpvDir, 'portable_config'));
    const mpvPath = path.join(mpvDir, 'mpv.exe');
    assert.equal(mpvUserConfigDir('win32', windowsDirs, {}, mpvPath, fs.existsSync), path.join(mpvDir, 'portable_config'));
});

test('a user-chosen mpv.exe without portable_config uses the roaming AppData folder', onWindowsHost, t => {
    const mpvPath = path.join(tempHome(t), 'mpv.exe');
    assert.equal(mpvUserConfigDir('win32', windowsDirs, {}, mpvPath, fs.existsSync), 'D:\\Profiles\\me\\Roaming\\mpv');
});

test('MPV_HOME wins over portable_config', onWindowsHost, t => {
    const mpvDir = tempHome(t);
    fs.mkdirSync(path.join(mpvDir, 'portable_config'));
    const env = { MPV_HOME: 'E:\\mpv-home' };
    assert.equal(mpvUserConfigDir('win32', windowsDirs, env, path.join(mpvDir, 'mpv.exe'), fs.existsSync), 'E:\\mpv-home');
});

test('Windows gives each playback its own named pipe instead of the shared mpvserver pipe', () => {
    const socket = mpvIpcSocket('win32', 'C:\\Users\\me\\AppData\\Local\\Temp', '4242-0a1b2c3d');
    assert.deepEqual(socket, { path: '\\\\.\\pipe\\fntv-mpv-4242-0a1b2c3d', isFile: false });
    assert.notEqual(mpvIpcSocket('win32', 'C:\\Temp', '4242-ffffffff').path, socket.path);
});

test('macOS and Linux put the socket file in the temp directory instead of /tmp/node-mpv.sock', () => {
    const macTmp = '/var/folders/zz/zyxvpxvq6csfxvn_n0000000000000/T';
    assert.deepEqual(mpvIpcSocket('darwin', macTmp, '4242-0a1b2c3d'), {
        path: `${macTmp}/fntv-mpv-4242-0a1b2c3d.sock`,
        isFile: true,
    });
    assert.deepEqual(mpvIpcSocket('linux', '/tmp', '4242-0a1b2c3d'), { path: '/tmp/fntv-mpv-4242-0a1b2c3d.sock', isFile: true });
});

test('a temp directory too long for a Unix socket address falls back to /tmp', () => {
    const longTmp = `/home/me/${'x'.repeat(100)}`;
    assert.deepEqual(mpvIpcSocket('linux', longTmp, '4242-0a1b2c3d'), { path: '/tmp/fntv-mpv-4242-0a1b2c3d.sock', isFile: true });
});

const bundledMpv = 'C:\\Program Files\\fntv\\third_party\\fntv-mpv\\mpv.exe';
const existing = (...paths) => (target) => paths.includes(target);

const found = (target) => ({ path: target, bundled: false });

test('a user-chosen MPV wins on every platform, even when it does not exist', () => {
    for (const platform of ['win32', 'darwin', 'linux']) {
        assert.deepEqual(mpvPlayer(platform, 'E:\\tools\\mpv.exe', bundledMpv, existing('/usr/bin/mpv')), found('E:\\tools\\mpv.exe'));
    }
});

test('choosing the bundled mpv.exe by hand counts as a user-chosen MPV', () => {
    assert.deepEqual(mpvPlayer('win32', bundledMpv, bundledMpv, existing(bundledMpv)), found(bundledMpv));
});

test('Windows without a user-chosen MPV uses the bundled MPV without checking that it exists', () => {
    assert.deepEqual(mpvPlayer('win32', undefined, bundledMpv, existing()), { path: bundledMpv, bundled: true });
});

test('macOS uses the first existing mpv among Homebrew, /usr/local and the app bundle', () => {
    const appBundle = '/Applications/mpv.app/Contents/MacOS/mpv';
    assert.deepEqual(mpvPlayer('darwin', undefined, bundledMpv, existing(appBundle, '/usr/local/bin/mpv')), found('/usr/local/bin/mpv'));
    assert.deepEqual(mpvPlayer('darwin', undefined, bundledMpv, existing(appBundle, '/opt/homebrew/bin/mpv')), found('/opt/homebrew/bin/mpv'));
    assert.deepEqual(mpvPlayer('darwin', undefined, bundledMpv, existing(appBundle)), found(appBundle));
});

test('Linux uses the first existing mpv among the system, local, snap, games and /opt locations', () => {
    assert.deepEqual(mpvPlayer('linux', undefined, bundledMpv, existing('/snap/bin/mpv', '/opt/mpv/bin/mpv')), found('/snap/bin/mpv'));
    assert.deepEqual(mpvPlayer('linux', undefined, bundledMpv, existing('/usr/games/mpv', '/usr/bin/mpv')), found('/usr/bin/mpv'));
    assert.deepEqual(mpvPlayer('linux', undefined, bundledMpv, existing('/opt/mpv/bin/mpv')), found('/opt/mpv/bin/mpv'));
});

test('macOS and Linux find no mpv when none of the known locations exist, and never fall back to the bundled MPV', () => {
    assert.equal(mpvPlayer('darwin', undefined, bundledMpv, existing(bundledMpv, '/usr/bin/mpv')), undefined);
    assert.equal(mpvPlayer('linux', undefined, bundledMpv, existing(bundledMpv, '/opt/homebrew/bin/mpv')), undefined);
});
