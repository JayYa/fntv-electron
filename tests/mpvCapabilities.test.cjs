// 启动时检查用户配置里装上的插件是否满足客户端的 requires（#224，契约见 docs/mpv-archive-contract.md“能力”一节）。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { synchronizeMpvConfig } = require('../dest/main/common/mpvConfigSync/sync.js');
const { checkMpvCapabilities } = require('../dest/main/common/mpvConfigSync/capabilities.js');
const { writeArchive, tempRoot } = require('./helpers/mpvManifestFixture.cjs');

const FILES = { 'mpv.conf': 'include="~~/fntv/defaults.conf"\n', 'scripts/smart_skip/main.lua': 'skip' };
const REQUIRES = { 'smart-skip.origin-from-play-url': 1, 'danmaku.example': 2 };

// 用真的同步装一次，让安装记录里的 provides 来自清单。
function installed(t, provides) {
    const root = tempRoot(t, 'caps');
    const archive = writeArchive(root, 'v1', { files: FILES, provides });
    const mpvConfigDir = path.join(root, 'user');
    const syncResult = synchronizeMpvConfig({ ...archive, mpvConfigDir, platform: 'win32' });
    assert.equal(syncResult.status, 'synced');
    return { syncResult, mpvConfigDir, manifestPath: archive.manifestPath };
}

test('the client requires smart_skip to take the Proxy origin from the play URL', () => {
    const { MPV_REQUIRED_CAPABILITIES } = require('../dest/main/common/mpvConfigSync/capabilities.js');
    assert.ok(MPV_REQUIRED_CAPABILITIES['smart-skip.origin-from-play-url'] >= 1);
});

test('installed plugins that provide every required capability satisfy the client', (t) => {
    const input = installed(t, { 'smart-skip.origin-from-play-url': 1, 'danmaku.example': 3, extra: 1 });
    assert.deepEqual(checkMpvCapabilities(input, REQUIRES), { satisfied: true, source: 'install-record' });
});

test('a capability the installed plugins do not provide is reported as missing', (t) => {
    const input = installed(t, { 'smart-skip.origin-from-play-url': 1 });
    assert.deepEqual(checkMpvCapabilities(input, REQUIRES), {
        satisfied: false,
        source: 'install-record',
        missing: [{ name: 'danmaku.example', required: 2 }],
    });
});

test('a capability provided at a lower version than required is reported with both versions', (t) => {
    const input = installed(t, { 'smart-skip.origin-from-play-url': 1, 'danmaku.example': 1 });
    assert.deepEqual(checkMpvCapabilities(input, REQUIRES), {
        satisfied: false,
        source: 'install-record',
        missing: [{ name: 'danmaku.example', required: 2, provided: 1 }],
    });
});

test('without an install record (sync never succeeded) nothing counts as provided', (t) => {
    const root = tempRoot(t, 'caps-none');
    const archive = writeArchive(root, 'v1', { files: FILES, provides: REQUIRES });
    const input = {
        syncResult: { status: 'failed', error: new Error('disk full'), files: [] },
        mpvConfigDir: path.join(root, 'user'),
        manifestPath: archive.manifestPath,
    };
    assert.deepEqual(checkMpvCapabilities(input, REQUIRES), {
        satisfied: false,
        source: 'install-record',
        reason: 'no-install-record',
        missing: [
            { name: 'smart-skip.origin-from-play-url', required: 1 },
            { name: 'danmaku.example', required: 2 },
        ],
    });
});

test('an older install record is still checked when this start-up sync failed', (t) => {
    const input = installed(t, { 'smart-skip.origin-from-play-url': 1, 'danmaku.example': 1 });
    input.syncResult = { status: 'failed', error: new Error('disk full'), files: [] };
    assert.deepEqual(checkMpvCapabilities(input, REQUIRES).missing, [{ name: 'danmaku.example', required: 2, provided: 1 }]);
});

test('when the user config is the portable config, the archive manifest is read instead', (t) => {
    const root = tempRoot(t, 'caps-same');
    const archive = writeArchive(root, 'v1', { files: FILES, provides: { 'smart-skip.origin-from-play-url': 1 } });
    const input = {
        syncResult: { status: 'skipped', reason: 'same-directory', detail: archive.portableConfigDir },
        mpvConfigDir: archive.portableConfigDir,
        manifestPath: archive.manifestPath,
    };
    assert.deepEqual(checkMpvCapabilities(input, REQUIRES), {
        satisfied: false,
        source: 'manifest',
        missing: [{ name: 'danmaku.example', required: 2 }],
    });
    assert.deepEqual(checkMpvCapabilities(input, { 'smart-skip.origin-from-play-url': 1 }), { satisfied: true, source: 'manifest' });
});

test('when the user config is the portable config and the manifest is missing, nothing counts as provided', (t) => {
    const root = tempRoot(t, 'caps-same-missing');
    const input = {
        syncResult: { status: 'skipped', reason: 'same-directory', detail: root },
        mpvConfigDir: root,
        manifestPath: path.join(root, 'fntv-manifest.json'),
    };
    const status = checkMpvCapabilities(input, { 'smart-skip.origin-from-play-url': 1 });
    assert.equal(status.satisfied, false);
    assert.equal(status.source, 'manifest');
    assert.equal(status.reason, 'manifest-missing');
    assert.deepEqual(status.missing, [{ name: 'smart-skip.origin-from-play-url', required: 1 }]);
});
