// 按清单同步用户配置：中途失败、中途退出（断电）之后下次启动补完，结果和一次跑完相同。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { synchronizeMpvConfig } = require('../dest/main/common/mpvConfigSync/sync.js');
const { nodeFileOps } = require('../dest/main/common/mpvConfigSync/stagedWrites.js');
const { writeArchive, writeTree, readTree, tempRoot, failingFileOps } = require('./helpers/mpvManifestFixture.cjs');

const V1 = {
    'mpv.conf': 'include="~~/fntv/defaults.conf"\n',
    'fntv/defaults.conf': 'volume=100\n',
    'input.conf': 'SPACE cycle pause\n',
    'script-opts/uosc.conf': 'controls=default\n',
    'scripts/uosc/main.lua': 'uosc 5.0',
    'scripts/uosc/lib/a.lua': 'uosc a 5.0',
    'scripts/uosc_danmaku/main.lua': 'VERSION = "2.0.0"',
    'scripts/uosc_danmaku/api.lua': 'api 2.0.0',
    'scripts/legacy.lua': 'legacy',
    'danmaku-history.json': '{}',
};
const { 'scripts/legacy.lua': _legacy, ...V1_WITHOUT_LEGACY } = V1;
const V2 = {
    ...V1_WITHOUT_LEGACY,
    'fntv/defaults.conf': 'volume=110\n',
    'input.conf': 'SPACE cycle pause\nENTER cycle fullscreen\n',
    'script-opts/uosc.conf': 'controls=v2\n',
    'scripts/uosc/main.lua': 'uosc 5.1',
    'scripts/uosc/lib/a.lua': 'uosc a 5.1',
    'scripts/uosc_danmaku/main.lua': 'VERSION = "2.1.0"',
    'scripts/uosc_danmaku/api.lua': 'api 2.1.0',
    'scripts/smart_skip/main.lua': 'smart_skip 1',
};
const MANAGED_DIRS = ['scripts/uosc', 'scripts/uosc_danmaku', 'scripts/smart_skip'];

// 已有用户：v1 装过（有记录），改了 input.conf，在弹幕插件目录放了自己的文件，现在升级到 v2。
// 每个场景一个独立目录，归档名相同，安装记录才能和参照逐字节比较。场景从同一份模板复制，省掉每次装 v1。
function prepare(root, name) {
    const template = path.join(root, 'template');
    if (!fs.existsSync(template)) {
        const v1 = writeArchive(template, 'v1', { files: V1 });
        const user = path.join(template, 'user');
        synchronizeMpvConfig({ ...v1, mpvConfigDir: user, platform: 'win32' });
        writeTree(user, {
            'input.conf': 'mine\n',
            'scripts/uosc_danmaku/danmaku/cache.xml': '<cached/>',
            'script-opts/smart_skip.conf': 'learned=1\n',
            'danmaku-history.json': '{"history":{"a":1}}',
        });
        writeArchive(template, 'v2', { files: V2 });
    }
    const dir = path.join(root, name);
    fs.cpSync(template, dir, { recursive: true });
    const v2 = {
        portableConfigDir: path.join(dir, 'v2', 'portable_config'),
        manifestPath: path.join(dir, 'v2', 'fntv-manifest.json'),
    };
    return { user: path.join(dir, 'user'), v2 };
}

function syncV2(v2, user, fileOps) {
    return synchronizeMpvConfig({ ...v2, mpvConfigDir: user, platform: 'win32', fileOps });
}

function subtree(tree, dir) {
    return Object.fromEntries(Object.entries(tree).filter(([file]) => file.startsWith(`${dir}/`)));
}

function referenceRun(root) {
    const { user, v2 } = prepare(root, 'reference');
    const before = readTree(user);
    const { ops, counter } = failingFileOps(nodeFileOps, 0);
    const result = syncV2(v2, user, ops);
    assert.equal(result.status, 'synced');
    return { before, after: readTree(user), conflicts: result.conflicts, writes: counter.calls };
}

// 托管目录要么整体是旧版，要么整体是新版，不会半新半旧。
function assertWholeManagedDirs(tree, reference, label) {
    for (const dir of MANAGED_DIRS) {
        const actual = subtree(tree, dir);
        const candidates = [subtree(reference.before, dir), subtree(reference.after, dir)];
        assert.ok(candidates.some(candidate => isDeepEqual(actual, candidate)),
            `${label}: ${dir} is half old, half new: ${JSON.stringify(actual)}`);
    }
}

function isDeepEqual(a, b) {
    try {
        assert.deepEqual(a, b);
        return true;
    } catch {
        return false;
    }
}

test('a sync that fails at any write leaves whole plugin directories and the next start finishes the job', (t) => {
    const root = tempRoot(t, 'fail');
    const reference = referenceRun(root);
    assert.ok(reference.writes > 10, `expected many writes, got ${reference.writes}`);

    for (let failAt = 1; failAt <= reference.writes; failAt += 1) {
        const { user, v2 } = prepare(root, `fail-${failAt}`);
        const { ops } = failingFileOps(nodeFileOps, failAt);

        const failed = syncV2(v2, user, ops);

        assert.equal(failed.status, 'failed', `write ${failAt}`);
        assert.match(failed.error.message, /injected failure/);
        const afterFailure = readTree(user);
        assertWholeManagedDirs(afterFailure, reference, `after failure at write ${failAt}`);
        assert.equal(afterFailure['fntv/installed.json'], reference.before['fntv/installed.json'], `record rewritten at write ${failAt}`);
        assert.equal(afterFailure['input.conf'], 'mine\n');

        const retried = syncV2(v2, user);

        assert.equal(retried.status, 'synced', `retry after write ${failAt}`);
        assert.deepEqual(retried.conflicts, reference.conflicts, `conflicts after write ${failAt}`);
        assert.deepEqual(readTree(user), reference.after, `tree after retrying write ${failAt}`);
    }
});

test('a sync killed at any write (power cut) is completed by the next start', (t) => {
    const root = tempRoot(t, 'kill');
    const reference = referenceRun(root);

    for (let killAt = 1; killAt <= reference.writes; killAt += 1) {
        const { user, v2 } = prepare(root, `kill-${killAt}`);
        const frozen = path.join(root, `frozen-${killAt}`);
        // 第 killAt 次写入之前把磁盘状态原样复制一份，就是进程在这一刻被杀掉时留下的样子。
        const freezing = Object.fromEntries(Object.entries(nodeFileOps).map(([name, fn]) => [name, (...args) => {
            freezing.calls = (freezing.calls ?? 0) + 1;
            if (freezing.calls === killAt) {
                fs.cpSync(user, frozen, { recursive: true });
                throw new Error('killed');
            }
            return fn(...args);
        }]));
        syncV2(v2, user, freezing);

        const resumed = syncV2(v2, frozen);

        assert.equal(resumed.status, 'synced', `resume after kill at write ${killAt}`);
        assert.deepEqual(resumed.conflicts, reference.conflicts, `conflicts after kill at write ${killAt}`);
        assert.deepEqual(readTree(frozen), reference.after, `tree after kill at write ${killAt}`);
    }
});

test('a portable config that does not match its manifest fails without touching the plugin directory', (t) => {
    const root = tempRoot(t, 'mismatch');
    const { user, v2 } = prepare(root, 'mismatch');
    const before = readTree(user);
    fs.writeFileSync(path.join(v2.portableConfigDir, 'scripts', 'uosc_danmaku', 'api.lua'), 'corrupted');

    const result = syncV2(v2, user);

    assert.equal(result.status, 'failed');
    assert.match(result.error.message, /Hash mismatch/);
    assert.deepEqual(subtree(readTree(user), 'scripts/uosc_danmaku'), subtree(before, 'scripts/uosc_danmaku'));
    assert.equal(fs.readdirSync(user).some(name => name.startsWith('.fntv-sync-')), false);
});
