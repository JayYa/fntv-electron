// 按清单同步用户配置：全新安装、已有用户（无记录 / 有记录）、用户改过文件。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { synchronizeMpvConfig } = require('../dest/main/common/mpvConfigSync/sync.js');
const { writeArchive, writeTree, readTree, readRecord, tempRoot, sha256 } = require('./helpers/mpvManifestFixture.cjs');

const V1 = {
    'mpv.conf': 'include="~~/fntv/defaults.conf"\n',
    'fntv/defaults.conf': 'volume=100\n',
    'input.conf': 'SPACE cycle pause\n',
    'script-opts/uosc.conf': 'controls=default\n',
    'scripts/uosc_danmaku/main.lua': 'VERSION = "2.0.0"',
    'scripts/uosc/main.lua': 'uosc 5.0',
    'fonts/a.ttf': 'font-a',
    'danmaku-history.json': '{"show_danmaku":true}',
};

function sync(archive, user, platform = 'win32', fileOps) {
    return synchronizeMpvConfig({ ...archive, mpvConfigDir: user, platform, fileOps });
}

function actionsOf(result) {
    return Object.fromEntries(result.files.map(entry => [entry.path, entry.action]));
}

test('fresh install copies every bundled file, reports no conflicts and writes the install record', (t) => {
    const root = tempRoot(t, 'fresh');
    const archive = writeArchive(root, 'v1', { files: V1, provides: { 'smart-skip.origin-from-play-url': 1 } });
    const user = path.join(root, 'user');

    const result = sync(archive, user);

    assert.equal(result.status, 'synced');
    assert.equal(result.hadInstallRecord, false);
    assert.deepEqual(result.conflicts, []);
    assert.ok(result.files.every(entry => entry.action === 'added'));
    const { 'fntv/installed.json': record, ...installed } = readTree(user);
    assert.deepEqual(installed, readTree(archive.portableConfigDir));
    assert.equal(JSON.parse(record).archiveVersion, 'v1');
    assert.deepEqual(JSON.parse(record).provides, { 'smart-skip.origin-from-play-url': 1 });
    assert.equal(JSON.parse(record).files['input.conf'].sha256, sha256(V1['input.conf']));
    assert.equal(fs.readdirSync(user).some(name => name.startsWith('.fntv-sync-')), false);
});

const V0 = {
    'mpv.conf': 'volume=90\n',
    'input.conf': 'SPACE cycle pause # old\n',
    'script-opts/uosc.conf': 'controls=old\n',
    'scripts/uosc_danmaku/main.lua': 'VERSION = "1.9.0"',
    'scripts/uosc/main.lua': 'uosc 4.0',
    'fonts/a.ttf': 'font-a',
    'danmaku-history.json': '{"show_danmaku":true}',
};
const V0_HISTORY = Object.fromEntries(Object.entries(V0).map(([file, content]) => [file, [content]]));

test('existing user without a record gets unmodified files replaced and modified configs as .fntv-new', (t) => {
    const root = tempRoot(t, 'norecord');
    const archive = writeArchive(root, 'v1', { files: V1, history: V0_HISTORY });
    const user = path.join(root, 'user');
    writeTree(user, {
        ...V0,
        'input.conf': 'SPACE cycle pause\nq quit # mine\n',
        'danmaku-history.json': '{"show_danmaku":false,"history":{}}',
        'script-opts/smart_skip.conf': 'port=12345\n',
        'scripts/uosc_danmaku/my-notes.txt': 'mine',
        'scripts/custom.lua': 'custom-script',
    });

    const result = sync(archive, user);

    assert.equal(result.status, 'synced');
    assert.equal(result.hadInstallRecord, false);
    assert.deepEqual(actionsOf(result), {
        'scripts/uosc/main.lua': 'replaced',
        'scripts/uosc_danmaku/main.lua': 'replaced',
        'mpv.conf': 'replaced',
        'fntv/defaults.conf': 'added',
        'input.conf': 'wrote-fntv-new',
        'script-opts/uosc.conf': 'replaced',
        'fonts/a.ttf': 'unchanged',
        'danmaku-history.json': 'kept',
    });
    assert.deepEqual(result.conflicts, [{ path: 'input.conf', sha256: sha256(V1['input.conf']) }]);
    const tree = readTree(user);
    assert.equal(tree['input.conf'], 'SPACE cycle pause\nq quit # mine\n');
    assert.equal(tree['input.conf.fntv-new'], V1['input.conf']);
    assert.equal(tree['mpv.conf'], V1['mpv.conf']);
    assert.equal(tree['scripts/uosc_danmaku/main.lua'], V1['scripts/uosc_danmaku/main.lua']);
    assert.equal(tree['scripts/uosc_danmaku/my-notes.txt'], 'mine');
    assert.equal(tree['scripts/custom.lua'], 'custom-script');
    assert.equal(tree['danmaku-history.json'], '{"show_danmaku":false,"history":{}}');
    assert.equal(tree['script-opts/smart_skip.conf'], 'port=12345\n');
});

test('a second sync of the same archive changes nothing on disk and reports every file unchanged or kept', (t) => {
    const root = tempRoot(t, 'rerun');
    const archive = writeArchive(root, 'v1', { files: V1, history: V0_HISTORY });
    const user = path.join(root, 'user');
    writeTree(user, { ...V0, 'input.conf': 'mine\n' });
    sync(archive, user);
    const before = readTree(user);

    const result = sync(archive, user);

    assert.equal(result.hadInstallRecord, true);
    assert.deepEqual(readTree(user), before);
    // .fntv-new 还在，冲突照样报出来；是否提示由已确认的冲突决定（mergePrompt）。
    assert.deepEqual(result.conflicts, [{ path: 'input.conf', sha256: sha256(V1['input.conf']) }]);
    assert.equal(actionsOf(result)['input.conf'], 'kept');
    assert.ok(result.files.filter(e => e.path !== 'input.conf' && e.path !== 'danmaku-history.json')
        .every(e => e.action === 'unchanged'));
});

const V2 = {
    ...V1,
    'fntv/defaults.conf': 'volume=110\n',
    'input.conf': 'SPACE cycle pause\nENTER cycle fullscreen\n',
    'script-opts/uosc.conf': 'controls=v2\n',
    'scripts/uosc_danmaku/main.lua': 'VERSION = "2.1.0"',
};
const V1_HISTORY = Object.fromEntries(Object.entries(V1).map(([file, content]) => [file, [content]]));

test('with a record, files equal to the recorded hash are replaced and user edits follow the conffile rules', (t) => {
    const root = tempRoot(t, 'record');
    const user = path.join(root, 'user');
    sync(writeArchive(root, 'v1', { files: V1 }), user);
    // 用户改了 input.conf（v2 也改了）、托管的 defaults.conf，以及 mpv.conf（v2 没改）。
    writeTree(user, {
        'input.conf': 'mine\n',
        'mpv.conf': `${V1['mpv.conf']}volume=50\n`,
        'fntv/defaults.conf': 'volume=1\n',
    });

    const result = sync(writeArchive(root, 'v2', { files: V2, history: V1_HISTORY }), user);

    assert.equal(result.hadInstallRecord, true);
    const actions = actionsOf(result);
    assert.equal(actions['input.conf'], 'wrote-fntv-new');
    assert.equal(actions['script-opts/uosc.conf'], 'replaced');
    assert.equal(actions['mpv.conf'], 'kept');
    assert.equal(actions['fntv/defaults.conf'], 'overwrote-modified');
    assert.equal(actions['scripts/uosc_danmaku/main.lua'], 'replaced');
    const tree = readTree(user);
    assert.equal(tree['input.conf'], 'mine\n');
    assert.equal(tree['input.conf.fntv-new'], V2['input.conf']);
    assert.equal(tree['mpv.conf'], `${V1['mpv.conf']}volume=50\n`);
    assert.equal(tree['mpv.conf.fntv-new'], undefined);
    assert.equal(tree['fntv/defaults.conf'], V2['fntv/defaults.conf']);
    assert.equal(readRecord(user).archiveVersion, 'v2');
});

test('a user edit back to a historical hash still counts as modified once a record exists', (t) => {
    const root = tempRoot(t, 'revert');
    const user = path.join(root, 'user');
    sync(writeArchive(root, 'v1', { files: V1, history: V0_HISTORY }), user);
    writeTree(user, { 'script-opts/uosc.conf': V0['script-opts/uosc.conf'] });

    const result = sync(writeArchive(root, 'v2', { files: V2, history: { ...V0_HISTORY, ...V1_HISTORY } }), user);

    assert.equal(actionsOf(result)['script-opts/uosc.conf'], 'wrote-fntv-new');
    assert.equal(readTree(user)['script-opts/uosc.conf'], V0['script-opts/uosc.conf']);
});

test('a newer archive replaces a stale .fntv-new and reports the new hash as a conflict again', (t) => {
    const root = tempRoot(t, 'renew');
    const user = path.join(root, 'user');
    writeTree(user, { 'input.conf': 'mine\n' });
    sync(writeArchive(root, 'v1', { files: V1 }), user);
    assert.equal(readTree(user)['input.conf.fntv-new'], V1['input.conf']);

    const result = sync(writeArchive(root, 'v2', { files: V2 }), user);

    assert.deepEqual(result.conflicts, [{ path: 'input.conf', sha256: sha256(V2['input.conf']) }]);
    assert.equal(readTree(user)['input.conf.fntv-new'], V2['input.conf']);
});

test('a pending .fntv-new stays a conflict on later syncs until the user deletes it', (t) => {
    const root = tempRoot(t, 'pending');
    const user = path.join(root, 'user');
    const archive = writeArchive(root, 'v1', { files: V1 });
    writeTree(user, { 'input.conf': 'mine\n' });
    sync(archive, user);

    assert.deepEqual(sync(archive, user).conflicts, [{ path: 'input.conf', sha256: sha256(V1['input.conf']) }]);

    fs.rmSync(path.join(user, 'input.conf.fntv-new'));
    const resolved = sync(archive, user);
    assert.deepEqual(resolved.conflicts, []);
    assert.equal(readTree(user)['input.conf'], 'mine\n');
    assert.equal(readTree(user)['input.conf.fntv-new'], undefined);
});

test('a config that matches no historical hash is treated as modified when there is no record', (t) => {
    const root = tempRoot(t, 'unknown');
    const user = path.join(root, 'user');
    writeTree(user, { 'script-opts/uosc.conf': 'from-upstream-QiaoKes\n' });

    const result = sync(writeArchive(root, 'v1', { files: V1, history: V0_HISTORY }), user);

    assert.deepEqual(result.conflicts, [{ path: 'script-opts/uosc.conf', sha256: sha256(V1['script-opts/uosc.conf']) }]);
    assert.equal(readTree(user)['script-opts/uosc.conf'], 'from-upstream-QiaoKes\n');
});

test('acknowledged conflicts in the install record survive a sync', (t) => {
    const root = tempRoot(t, 'ack');
    const user = path.join(root, 'user');
    const archive = writeArchive(root, 'v1', { files: V1 });
    sync(archive, user);
    const acknowledged = [{ path: 'input.conf', sha256: sha256(V1['input.conf']) }];
    fs.writeFileSync(path.join(user, 'fntv', 'installed.json'), JSON.stringify({ ...readRecord(user), acknowledgedConflicts: acknowledged }));

    const result = sync(archive, user);

    assert.deepEqual(result.acknowledgedConflicts, acknowledged);
    assert.deepEqual(readRecord(user).acknowledgedConflicts, acknowledged);
});
