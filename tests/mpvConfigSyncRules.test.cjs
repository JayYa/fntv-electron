// 按清单同步用户配置：删除归档删掉的文件、托管目录里的用户文件、整体跳过、macOS/Linux 的 mpv.conf 例外。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { synchronizeMpvConfig } = require('../dest/main/common/mpvConfigSync/sync.js');
const { SUPPORTED_MANIFEST_FORMAT_VERSIONS } = require('../dest/main/common/mpvConfigSync/manifest.js');
const { writeArchive, writeTree, readTree, readRecord, tempRoot } = require('./helpers/mpvManifestFixture.cjs');

function sync(archive, user, platform = 'win32') {
    return synchronizeMpvConfig({ ...archive, mpvConfigDir: user, platform });
}

function actionsOf(result) {
    return Object.fromEntries(result.files.map(entry => [entry.path, entry.action]));
}

const BASE = {
    'mpv.conf': 'include="~~/fntv/defaults.conf"\n',
    'input.conf': 'SPACE cycle pause\n',
    'scripts/uosc/main.lua': 'uosc 5.0',
    'scripts/uosc/lib/old.lua': 'old helper',
    'scripts/legacy.lua': 'legacy script',
    'script-opts/legacy.conf': 'legacy=1\n',
    'danmaku-history.json': '{}',
};
const { 'scripts/uosc/lib/old.lua': _a, 'scripts/legacy.lua': _b, 'script-opts/legacy.conf': _c, ...TRIMMED } = BASE;

test('files dropped from the archive are removed when unmodified, kept when modified, and configs are always kept', (t) => {
    const root = tempRoot(t, 'drop');
    const user = path.join(root, 'user');
    sync(writeArchive(root, 'v1', { files: BASE }), user);
    writeTree(user, { 'scripts/uosc/lib/old.lua': 'my patch' });

    const result = sync(writeArchive(root, 'v2', { files: { ...TRIMMED, 'scripts/uosc/main.lua': 'uosc 5.1' } }), user);

    const actions = actionsOf(result);
    assert.equal(actions['scripts/legacy.lua'], 'removed');
    assert.equal(actions['scripts/uosc/lib/old.lua'], 'kept');
    assert.equal(actions['script-opts/legacy.conf'], 'kept');
    const tree = readTree(user);
    assert.equal(tree['scripts/legacy.lua'], undefined);
    assert.equal(tree['scripts/uosc/lib/old.lua'], 'my patch');
    assert.equal(tree['scripts/uosc/main.lua'], 'uosc 5.1');
    assert.equal(tree['script-opts/legacy.conf'], 'legacy=1\n');
    assert.equal(readRecord(user).files['script-opts/legacy.conf'], undefined);
});

test('without a record, obsolete entries decide which dropped files are removed', (t) => {
    const root = tempRoot(t, 'obsolete');
    const user = path.join(root, 'user');
    writeTree(user, {
        'scripts/legacy.lua': 'legacy script',
        'scripts/uosc/lib/old.lua': 'old helper',
        'scripts/other.lua': 'edited legacy',
        'scripts/mine.lua': 'not ours',
    });
    const archive = writeArchive(root, 'v2', {
        files: TRIMMED,
        obsolete: {
            'scripts/legacy.lua': ['legacy script'],
            'scripts/uosc/lib/old.lua': ['old helper'],
            'scripts/other.lua': ['legacy other'],
        },
    });

    const result = sync(archive, user);

    const actions = actionsOf(result);
    assert.equal(actions['scripts/legacy.lua'], 'removed');
    assert.equal(actions['scripts/uosc/lib/old.lua'], 'removed');
    assert.equal(actions['scripts/other.lua'], 'kept');
    assert.equal(actions['scripts/mine.lua'], undefined);
    const tree = readTree(user);
    assert.equal(tree['scripts/legacy.lua'], undefined);
    assert.equal(tree['scripts/uosc/lib/old.lua'], undefined);
    assert.equal(tree['scripts/other.lua'], 'edited legacy');
    assert.equal(tree['scripts/mine.lua'], 'not ours');
});

test('a managed directory is replaced as a whole and keeps files the manifest does not list', (t) => {
    const root = tempRoot(t, 'carry');
    const user = path.join(root, 'user');
    writeTree(user, {
        'scripts/uosc_danmaku/main.lua': 'self-updated by check-update',
        'scripts/uosc_danmaku/danmaku/cache.xml': '<cached/>',
        'danmaku-history.json': '{"history":{"a":1}}',
        'script-opts/smart_skip.conf': 'learned=1\n',
    });
    const files = { ...TRIMMED, 'scripts/uosc_danmaku/main.lua': 'VERSION = "2.1.0"', 'scripts/uosc_danmaku/api.lua': 'api' };

    const result = sync(writeArchive(root, 'v1', { files }), user);

    assert.equal(actionsOf(result)['scripts/uosc_danmaku/main.lua'], 'overwrote-modified');
    const tree = readTree(user);
    assert.equal(tree['scripts/uosc_danmaku/main.lua'], 'VERSION = "2.1.0"');
    assert.equal(tree['scripts/uosc_danmaku/api.lua'], 'api');
    assert.equal(tree['scripts/uosc_danmaku/danmaku/cache.xml'], '<cached/>');
    assert.equal(tree['danmaku-history.json'], '{"history":{"a":1}}');
    assert.equal(tree['script-opts/smart_skip.conf'], 'learned=1\n');
});

test('skips with same-directory when the user config is the portable config and writes nothing', (t) => {
    const root = tempRoot(t, 'same');
    const archive = writeArchive(root, 'v1', { files: BASE });
    const before = readTree(path.join(root, 'v1'));
    const alias = path.join(archive.portableConfigDir, 'scripts', '..') + path.sep;

    const result = sync(archive, alias);

    assert.deepEqual({ status: result.status, reason: result.reason }, { status: 'skipped', reason: 'same-directory' });
    assert.deepEqual(readTree(path.join(root, 'v1')), before);
});

for (const [label, reason, prepare] of [
    ['the manifest is missing', 'manifest-missing', archive => fs.rmSync(archive.manifestPath)],
    ['the format version is unknown', 'manifest-unsupported', archive => fs.writeFileSync(
        archive.manifestPath, JSON.stringify({ ...archive.manifest, formatVersion: Math.max(...SUPPORTED_MANIFEST_FORMAT_VERSIONS) + 1 }))],
    ['the manifest is not valid JSON', 'manifest-invalid', archive => fs.writeFileSync(archive.manifestPath, '{')],
    ['a manifest path escapes the config directory', 'manifest-invalid', archive => fs.writeFileSync(
        archive.manifestPath, JSON.stringify({ ...archive.manifest, files: [{ ...archive.manifest.files[0], path: '../evil' }] }))],
]) {
    test(`changes nothing when ${label}`, (t) => {
        const root = tempRoot(t, 'nomanifest');
        const user = path.join(root, 'user');
        sync(writeArchive(root, 'v1', { files: BASE }), user);
        writeTree(user, { 'input.conf': 'mine\n' });
        const before = readTree(user);
        const archive = writeArchive(root, 'v2', { files: { ...BASE, 'input.conf': 'new\n', 'scripts/uosc/main.lua': 'uosc 6' } });
        prepare(archive);

        const result = sync(archive, user);

        assert.deepEqual({ status: result.status, reason: result.reason }, { status: 'skipped', reason });
        assert.deepEqual(readTree(user), before);
    });
}

for (const platform of ['darwin', 'linux']) {
    test(`on ${platform} an unknown mpv.conf without a record stays the user's and is not a conflict`, (t) => {
        const root = tempRoot(t, `mpvconf-${platform}`);
        const user = path.join(root, 'user');
        writeTree(user, { 'mpv.conf': 'hwdec=auto\n', 'input.conf': 'mine\n' });
        const files = { ...TRIMMED, 'fntv/defaults.conf': 'volume=100\n' };
        const archive = writeArchive(root, 'v1', { files });

        const result = sync(archive, user, platform);

        assert.equal(actionsOf(result)['mpv.conf'], 'kept');
        assert.deepEqual(result.conflicts.map(c => c.path), ['input.conf']);
        const tree = readTree(user);
        assert.equal(tree['mpv.conf'], 'hwdec=auto\n');
        assert.equal(tree['mpv.conf.fntv-new'], undefined);
        assert.equal(tree['fntv/defaults.conf'], 'volume=100\n');

        // 下次（仍没有 mpv.conf 的记录）也一样，不会因为有了安装记录就开始提示。
        const again = sync(writeArchive(root, 'v2', { files: { ...files, 'mpv.conf': 'include v2\n' } }), user, platform);
        assert.equal(actionsOf(again)['mpv.conf'], 'kept');
        assert.equal(readTree(user)['mpv.conf.fntv-new'], undefined);
    });

    test(`on ${platform} an mpv.conf from a known archive is replaced like on Windows`, (t) => {
        const root = tempRoot(t, `mpvconf-known-${platform}`);
        const user = path.join(root, 'user');
        writeTree(user, { 'mpv.conf': 'volume=90\n' });

        const result = sync(writeArchive(root, 'v1', { files: TRIMMED, history: { 'mpv.conf': ['volume=90\n'] } }), user, platform);

        assert.equal(actionsOf(result)['mpv.conf'], 'replaced');
        assert.equal(readTree(user)['mpv.conf'], TRIMMED['mpv.conf']);
    });
}

test('on Windows an unknown mpv.conf without a record gets a .fntv-new', (t) => {
    const root = tempRoot(t, 'mpvconf-win');
    const user = path.join(root, 'user');
    writeTree(user, { 'mpv.conf': 'hwdec=auto\n' });

    const result = sync(writeArchive(root, 'v1', { files: TRIMMED }), user, 'win32');

    assert.deepEqual(result.conflicts.map(c => c.path), ['mpv.conf']);
    assert.equal(readTree(user)['mpv.conf.fntv-new'], TRIMMED['mpv.conf']);
});
