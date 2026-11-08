const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    resolveBundledMpvPath,
    resolvePortableConfigDir,
    synchronizeMpvConfig,
} = require('../dest/main/common/mpvConfigHelpers.js');

test('resolves the packaged mpv executable next to the application executable', () => {
    assert.equal(
        resolveBundledMpvPath({
            appPath: path.join('C:', 'app', 'resources', 'app.asar'),
            execPath: path.join('C:', 'app', 'FNMedia.exe'),
            isPackaged: true,
        }),
        path.join('C:', 'app', 'third_party', 'fntv-mpv', 'mpv.exe'),
    );
});

test('resolves packaged extraFiles next to the resources directory on every platform', () => {
    assert.equal(
        resolvePortableConfigDir({
            appPath: path.join('C:', 'app', 'resources', 'app.asar'),
            isPackaged: true,
            resourcesPath: path.join('C:', 'app', 'resources'),
        }),
        path.join('C:', 'app', 'third_party', 'fntv-mpv', 'portable_config'),
    );
});

test('updates only managed danmaku code and preserves user-owned MPV state', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-mpv-sync-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const portable = path.join(root, 'portable_config');
    const user = path.join(root, 'user_config');
    const bundledPlugin = path.join(portable, 'scripts', 'uosc_danmaku');
    const userPlugin = path.join(user, 'scripts', 'uosc_danmaku');
    fs.mkdirSync(bundledPlugin, { recursive: true });
    fs.mkdirSync(userPlugin, { recursive: true });
    fs.mkdirSync(path.join(user, 'script-opts'), { recursive: true });

    fs.writeFileSync(path.join(bundledPlugin, 'main.lua'), 'VERSION = "2.1.0"');
    fs.writeFileSync(path.join(userPlugin, 'main.lua'), 'VERSION = "2.0.0"');
    fs.writeFileSync(path.join(user, 'scripts', 'custom.lua'), 'custom-script');

    const preservedFiles = new Map([
        [path.join(user, 'script-opts', 'uosc_danmaku.conf'), Buffer.from('opacity=0.42\n')],
        [path.join(user, 'script-opts', 'uosc.conf'), Buffer.from('controls=custom\r\n')],
        [path.join(user, 'danmaku-history.json'), Buffer.from('{"show_danmaku":false}')],
    ]);
    for (const [file, content] of preservedFiles) fs.writeFileSync(file, content);

    assert.equal(synchronizeMpvConfig(portable, user), 'updated');
    assert.equal(fs.readFileSync(path.join(userPlugin, 'main.lua'), 'utf8'), 'VERSION = "2.1.0"');
    assert.equal(fs.readFileSync(path.join(user, 'scripts', 'custom.lua'), 'utf8'), 'custom-script');
    for (const [file, content] of preservedFiles) {
        assert.deepEqual(fs.readFileSync(file), content);
    }
});

test('seeds the complete bundled configuration on first initialization', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-mpv-init-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const portable = path.join(root, 'portable_config');
    const user = path.join(root, 'user_config');
    fs.mkdirSync(path.join(portable, 'scripts', 'uosc_danmaku'), { recursive: true });
    fs.writeFileSync(path.join(portable, 'scripts', 'uosc_danmaku', 'main.lua'), 'bundled');
    fs.writeFileSync(path.join(portable, 'danmaku-history.json'), '{"show_danmaku":true}');

    assert.equal(synchronizeMpvConfig(portable, user), 'initialized');
    assert.equal(fs.readFileSync(path.join(user, 'scripts', 'uosc_danmaku', 'main.lua'), 'utf8'), 'bundled');
    assert.equal(fs.readFileSync(path.join(user, 'danmaku-history.json'), 'utf8'), '{"show_danmaku":true}');
});

test('first initialization does not overwrite pre-existing user state', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-mpv-seed-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const portable = path.join(root, 'portable_config');
    const user = path.join(root, 'user_config');
    fs.mkdirSync(path.join(portable, 'scripts', 'uosc_danmaku'), { recursive: true });
    fs.mkdirSync(path.join(portable, 'script-opts'), { recursive: true });
    fs.mkdirSync(path.join(user, 'script-opts'), { recursive: true });
    fs.writeFileSync(path.join(portable, 'scripts', 'uosc_danmaku', 'main.lua'), 'bundled');
    fs.writeFileSync(path.join(portable, 'script-opts', 'uosc.conf'), 'bundled-controls');
    fs.writeFileSync(path.join(user, 'script-opts', 'uosc.conf'), 'user-controls');

    assert.equal(synchronizeMpvConfig(portable, user), 'initialized');
    assert.equal(fs.readFileSync(path.join(user, 'script-opts', 'uosc.conf'), 'utf8'), 'user-controls');
    assert.equal(fs.readFileSync(path.join(user, 'scripts', 'uosc_danmaku', 'main.lua'), 'utf8'), 'bundled');
});

const onWindowsHost = { skip: process.platform !== 'win32' && 'Windows paths only resolve on a Windows host' };

function createBundledMpv(root) {
    const bundleDir = path.join(root, 'third_party', 'fntv-mpv');
    const portable = path.join(bundleDir, 'portable_config');
    const plugin = path.join(portable, 'scripts', 'uosc_danmaku');
    fs.mkdirSync(path.join(plugin, 'modules'), { recursive: true });
    fs.writeFileSync(path.join(bundleDir, 'mpv.exe'), '');
    fs.writeFileSync(path.join(plugin, 'main.lua'), 'VERSION = "2.1.0"');
    fs.writeFileSync(path.join(plugin, 'modules', 'render.lua'), 'render');
    fs.writeFileSync(path.join(plugin, '.gitignore'), 'danmaku/*\n');
    return { mpvPath: path.join(bundleDir, 'mpv.exe'), portable, plugin };
}

test('leaves the bundled plugin intact when the chosen mpv is the bundled mpv', onWindowsHost, (t) => {
    const { mpvUserConfigDir } = require('../dest/public/platform.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-mpv-same-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const { mpvPath, portable, plugin } = createBundledMpv(root);
    const dirs = { homeDir: root, appDataDir: path.join(root, 'AppData', 'Roaming') };

    const target = mpvUserConfigDir('win32', dirs, {}, mpvPath, fs.existsSync);

    assert.equal(synchronizeMpvConfig(portable, target), 'same-directory');
    assert.equal(fs.readFileSync(path.join(plugin, 'main.lua'), 'utf8'), 'VERSION = "2.1.0"');
    assert.equal(fs.readFileSync(path.join(plugin, 'modules', 'render.lua'), 'utf8'), 'render');
    assert.equal(fs.readFileSync(path.join(plugin, '.gitignore'), 'utf8'), 'danmaku/*\n');
    assert.equal(fs.existsSync(dirs.appDataDir), false);
});

test('treats differently spelled paths to the same portable config as the same directory', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-mpv-alias-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const { portable, plugin } = createBundledMpv(root);
    const alias = path.join(portable, 'scripts', '..') + path.sep;

    assert.equal(synchronizeMpvConfig(portable, alias), 'same-directory');
    assert.equal(fs.readFileSync(path.join(plugin, 'main.lua'), 'utf8'), 'VERSION = "2.1.0"');
});

test('refuses to report a sync when the bundled plugin has no entry script and keeps the working copy', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-mpv-noentry-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const portable = path.join(root, 'portable_config');
    const user = path.join(root, 'user_config');
    const userPlugin = path.join(user, 'scripts', 'uosc_danmaku');
    fs.mkdirSync(path.join(portable, 'scripts', 'uosc_danmaku'), { recursive: true });
    fs.writeFileSync(path.join(portable, 'scripts', 'uosc_danmaku', '.gitignore'), 'danmaku/*\n');
    fs.mkdirSync(userPlugin, { recursive: true });
    fs.writeFileSync(path.join(userPlugin, 'main.lua'), 'VERSION = "2.0.0"');

    assert.throws(() => synchronizeMpvConfig(portable, user), /main\.lua/);
    assert.equal(fs.readFileSync(path.join(userPlugin, 'main.lua'), 'utf8'), 'VERSION = "2.0.0"');
    assert.deepEqual(fs.readdirSync(user).sort(), ['scripts']);
    assert.deepEqual(fs.readdirSync(path.join(user, 'scripts')), ['uosc_danmaku']);
});

test('replaces stale plugin files and leaves no staging directory behind', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-mpv-swap-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const portable = path.join(root, 'portable_config');
    const user = path.join(root, 'user_config');
    const userPlugin = path.join(user, 'scripts', 'uosc_danmaku');
    fs.mkdirSync(path.join(portable, 'scripts', 'uosc_danmaku'), { recursive: true });
    fs.writeFileSync(path.join(portable, 'scripts', 'uosc_danmaku', 'main.lua'), 'VERSION = "2.1.0"');
    fs.mkdirSync(userPlugin, { recursive: true });
    fs.writeFileSync(path.join(userPlugin, 'main.lua'), 'VERSION = "2.0.0"');
    fs.writeFileSync(path.join(userPlugin, 'removed-upstream.lua'), 'old');

    assert.equal(synchronizeMpvConfig(portable, user), 'updated');
    assert.deepEqual(fs.readdirSync(userPlugin), ['main.lua']);
    assert.deepEqual(fs.readdirSync(user), ['scripts']);
    assert.deepEqual(fs.readdirSync(path.join(user, 'scripts')), ['uosc_danmaku']);
});
