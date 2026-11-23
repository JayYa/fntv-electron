const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readTree, tempRoot } = require('./helpers/mpvManifestFixture.cjs');
const {
    MANAGED_DIRS, RECORD, prepare, syncV2, referenceRun, subtree, assertWholeManagedDirs, hasStaging,
} = require('./helpers/mpvUpgradeScenario.cjs');

const isWindows = process.platform === 'win32';
const posixRoot = !isWindows && process.getuid() === 0;

function blockPluginDirectoryMove(user) {
    if (isWindows) {
        const fd = fs.openSync(path.join(user, 'scripts', 'uosc_danmaku', 'api.lua'), 'r');
        return () => fs.closeSync(fd);
    }
    const scripts = path.join(user, 'scripts');
    fs.chmodSync(scripts, 0o555);
    return () => fs.chmodSync(scripts, 0o755);
}

function blockConfigReplace(user) {
    const target = isWindows ? path.join(user, 'script-opts', 'uosc.conf') : path.join(user, 'script-opts');
    fs.chmodSync(target, isWindows ? 0o444 : 0o555);
    return () => fs.chmodSync(target, isWindows ? 0o644 : 0o755);
}

function assertFailedCleanly(failed, user, reference) {
    assert.equal(failed.status, 'failed');
    const tree = readTree(user);
    assertWholeManagedDirs(tree, reference, 'after failure');
    assert.equal(tree[RECORD], reference.before[RECORD], 'install record rewritten by a failed sync');
    assert.equal(tree['input.conf'], 'mine\n');
    assert.equal(tree['scripts/uosc_danmaku/danmaku/cache.xml'], '<cached/>');
    assert.equal(hasStaging(user), false);
    return tree;
}

function assertRetryFinishes(v2, user, reference) {
    const retried = syncV2(v2, user);
    assert.equal(retried.status, 'synced');
    assert.deepEqual(retried.conflicts, reference.conflicts);
    assert.deepEqual(readTree(user), reference.after);
}

test('a plugin directory that cannot be moved aside fails the sync without breaking any plugin directory', { skip: posixRoot && 'root ignores directory permissions' }, (t) => {
    const root = tempRoot(t, 'fail-dir');
    const reference = referenceRun(root);
    const { user, v2 } = prepare(root, 'fail-dir');
    const release = blockPluginDirectoryMove(user);
    let failed;
    try {
        failed = syncV2(v2, user);
    } finally {
        release();
    }

    assertFailedCleanly(failed, user, reference);
    assertRetryFinishes(v2, user, reference);
});

test('a config file that cannot be replaced fails the sync after the plugin directories were replaced', { skip: posixRoot && 'root ignores directory permissions' }, (t) => {
    const root = tempRoot(t, 'fail-config');
    const reference = referenceRun(root);
    const { user, v2 } = prepare(root, 'fail-config');
    const release = blockConfigReplace(user);
    let failed;
    try {
        failed = syncV2(v2, user);
    } finally {
        release();
    }

    const tree = assertFailedCleanly(failed, user, reference);
    for (const dir of MANAGED_DIRS) assert.deepEqual(subtree(tree, dir), subtree(reference.after, dir), dir);
    assert.equal(tree['script-opts/uosc.conf'], reference.before['script-opts/uosc.conf']);
    assertRetryFinishes(v2, user, reference);
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
    assert.equal(hasStaging(user), false);
});
