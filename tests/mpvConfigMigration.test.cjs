// 便携配置和附带 MPV 的定位、同目录判断、同步结果写进日志的样子。按清单同步的规则见 mpvConfigSync*.test.cjs。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBundledMpvPath, resolvePortableConfigDir } = require('../dest/main/common/mpvConfigHelpers.js');
const { resolveManifestPath } = require('../dest/main/common/mpvConfigSync/manifest.js');
const { synchronizeMpvConfig } = require('../dest/main/common/mpvConfigSync/sync.js');
const { mpvConfigSyncLogLines } = require('../dest/main/common/mpvConfigSync/log.js');
const { writeArchive, writeTree, readTree, tempRoot } = require('./helpers/mpvManifestFixture.cjs');

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

test('finds the manifest at the archive root next to the portable config', () => {
    const portable = path.join('C:', 'app', 'third_party', 'fntv-mpv', 'portable_config');
    assert.equal(resolveManifestPath(portable), path.join('C:', 'app', 'third_party', 'fntv-mpv', 'fntv-manifest.json'));
});

const onWindowsHost = { skip: process.platform !== 'win32' && 'Windows paths only resolve on a Windows host' };

test('leaves the bundled config intact when the chosen mpv is the bundled mpv', onWindowsHost, (t) => {
    const { mpvUserConfigDir } = require('../dest/public/platform.js');
    const root = tempRoot(t, 'same');
    const bundleDir = path.join(root, 'third_party', 'fntv-mpv');
    const archive = writeArchive(path.join(root, 'third_party'), 'fntv-mpv', {
        files: { 'scripts/uosc_danmaku/main.lua': 'VERSION = "2.1.0"', 'input.conf': 'bundled\n' },
    });
    fs.writeFileSync(path.join(bundleDir, 'mpv.exe'), '');
    const before = readTree(bundleDir);
    const dirs = { homeDir: root, appDataDir: path.join(root, 'AppData', 'Roaming') };

    const target = mpvUserConfigDir('win32', dirs, {}, path.join(bundleDir, 'mpv.exe'), fs.existsSync);
    const result = synchronizeMpvConfig({ ...archive, mpvConfigDir: target, platform: 'win32' });

    assert.deepEqual({ status: result.status, reason: result.reason }, { status: 'skipped', reason: 'same-directory' });
    assert.deepEqual(readTree(bundleDir), before);
    assert.equal(fs.existsSync(dirs.appDataDir), false);
});

test('logs each file action, warns on same-directory and reports manifest problems as errors', (t) => {
    const root = tempRoot(t, 'log');
    const user = path.join(root, 'user');
    writeTree(user, { 'input.conf': 'mine\n' });
    const archive = writeArchive(root, 'v1', { files: { 'input.conf': 'new\n', 'fonts/a.ttf': 'a' } });
    writeTree(user, { 'fonts/a.ttf': 'a' });

    const synced = mpvConfigSyncLogLines(synchronizeMpvConfig({ ...archive, mpvConfigDir: user, platform: 'win32' }), user);

    assert.deepEqual(synced.map(line => line.level), ['info', 'info']);
    assert.match(synced[0].message, /v1/);
    assert.match(synced[0].message, /1 个文件未变/);
    assert.match(synced[0].message, /1 个待合并/);
    assert.match(synced[1].message, /\.fntv-new: input\.conf/);

    const same = mpvConfigSyncLogLines({ status: 'skipped', reason: 'same-directory', detail: user }, user);
    assert.deepEqual(same.map(line => line.level), ['warn']);

    fs.rmSync(archive.manifestPath);
    const missing = mpvConfigSyncLogLines(synchronizeMpvConfig({ ...archive, mpvConfigDir: user, platform: 'win32' }), user);
    assert.deepEqual(missing.map(line => line.level), ['error']);
    assert.match(missing[0].message, /清单缺失/);

    const failed = mpvConfigSyncLogLines({ status: 'failed', error: new Error('disk full'), files: [{ path: 'input.conf', action: 'replaced' }] }, user);
    assert.deepEqual(failed.map(line => line.level), ['error', 'info']);
    assert.equal(failed[0].error.message, 'disk full');
});
