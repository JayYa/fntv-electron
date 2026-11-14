// 启动时检查用户配置里装上的插件是否满足客户端的 requires（#224，契约见 docs/mpv-archive-contract.md“能力”一节）。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { synchronizeMpvConfig } = require('../dest/main/common/mpvConfigSync/sync.js');
const { checkMpvCapabilities, MPV_REQUIRED_CAPABILITIES } = require('../dest/main/common/mpvConfigSync/capabilities.js');
const { writeArchive, tempRoot } = require('./helpers/mpvManifestFixture.cjs');

const FILES = { 'mpv.conf': 'include="~~/fntv/defaults.conf"\n', 'scripts/smart_skip/main.lua': 'skip' };
// 客户端实际要求的能力；不满足的清单从它改出来。
const [[NAME, VERSION]] = Object.entries(MPV_REQUIRED_CAPABILITIES);
const SATISFYING = { ...MPV_REQUIRED_CAPABILITIES, 'danmaku.extra': 3 };
const { [NAME]: _dropped, ...WITHOUT_NAME } = MPV_REQUIRED_CAPABILITIES;
const ALL_MISSING = Object.entries(MPV_REQUIRED_CAPABILITIES).map(([name, required]) => ({ name, required }));

// 用真的同步装一次，让安装记录里的 provides 来自清单。
function installed(t, provides) {
    const root = tempRoot(t, 'caps');
    const archive = writeArchive(root, 'v1', { files: FILES, provides });
    const mpvConfigDir = path.join(root, 'user');
    const syncResult = synchronizeMpvConfig({ ...archive, mpvConfigDir, platform: 'win32' });
    assert.equal(syncResult.status, 'synced');
    return { syncResult, mpvConfigDir, manifestPath: archive.manifestPath };
}

function sameDirectory(t, provides) {
    const root = tempRoot(t, 'caps-same');
    const archive = writeArchive(root, 'v1', { files: FILES, provides });
    return {
        syncResult: { status: 'skipped', reason: 'same-directory', detail: archive.portableConfigDir },
        mpvConfigDir: archive.portableConfigDir,
        manifestPath: archive.manifestPath,
    };
}

test('the client requires smart_skip to take the Proxy origin from the play URL', () => {
    assert.ok(MPV_REQUIRED_CAPABILITIES['smart-skip.origin-from-play-url'] >= 1);
});

test('installed plugins that provide every required capability satisfy the client', (t) => {
    assert.deepEqual(checkMpvCapabilities(installed(t, SATISFYING)), { satisfied: true, source: 'install-record' });
});

test('a capability the installed plugins do not provide is reported as missing', (t) => {
    assert.deepEqual(checkMpvCapabilities(installed(t, WITHOUT_NAME)), {
        satisfied: false,
        source: 'install-record',
        missing: [{ name: NAME, required: VERSION }],
    });
});

test('a capability provided at a lower version than required is reported with both versions', (t) => {
    const input = installed(t, { ...SATISFYING, [NAME]: VERSION - 1 });
    assert.deepEqual(checkMpvCapabilities(input), {
        satisfied: false,
        source: 'install-record',
        missing: [{ name: NAME, required: VERSION, provided: VERSION - 1 }],
    });
});

test('without an install record (sync never succeeded) nothing counts as provided', (t) => {
    const root = tempRoot(t, 'caps-none');
    const archive = writeArchive(root, 'v1', { files: FILES, provides: SATISFYING });
    const input = {
        syncResult: { status: 'failed', error: new Error('disk full'), files: [] },
        mpvConfigDir: path.join(root, 'user'),
        manifestPath: archive.manifestPath,
    };
    assert.deepEqual(checkMpvCapabilities(input), {
        satisfied: false,
        source: 'install-record',
        reason: 'no-install-record',
        missing: ALL_MISSING,
    });
});

test('an older install record is still checked when this start-up sync failed', (t) => {
    const input = installed(t, { ...SATISFYING, [NAME]: VERSION - 1 });
    input.syncResult = { status: 'failed', error: new Error('disk full'), files: [] };
    assert.deepEqual(checkMpvCapabilities(input).missing, [{ name: NAME, required: VERSION, provided: VERSION - 1 }]);
});

test('when the user config is the portable config, the archive manifest is read instead', (t) => {
    assert.deepEqual(checkMpvCapabilities(sameDirectory(t, SATISFYING)), { satisfied: true, source: 'manifest' });
    assert.deepEqual(checkMpvCapabilities(sameDirectory(t, WITHOUT_NAME)), {
        satisfied: false,
        source: 'manifest',
        missing: [{ name: NAME, required: VERSION }],
    });
});

test('when the user config is the portable config and the manifest is missing, nothing counts as provided', (t) => {
    const root = tempRoot(t, 'caps-same-missing');
    const input = {
        syncResult: { status: 'skipped', reason: 'same-directory', detail: root },
        mpvConfigDir: root,
        manifestPath: path.join(root, 'fntv-manifest.json'),
    };
    assert.deepEqual(checkMpvCapabilities(input), {
        satisfied: false,
        source: 'manifest',
        reason: 'manifest-missing',
        missing: ALL_MISSING,
    });
});
