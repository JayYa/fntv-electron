// 同步中途失败、中途退出的测试共用的升级场景：已有用户 v1 装过（有记录），改了 input.conf，
// 在弹幕插件目录放了自己的文件，现在升级到 v2。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { synchronizeMpvConfig } = require('../../dest/main/common/mpvConfigSync/sync.js');
const { writeArchive, writeTree, readTree } = require('./mpvManifestFixture.cjs');

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
const RECORD = 'fntv/installed.json';

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

function syncV2(v2, user) {
    return synchronizeMpvConfig({ ...v2, mpvConfigDir: user, platform: 'win32' });
}

// 一次跑完的升级：before 是升级前的用户配置，after 是升级后的。
function referenceRun(root) {
    const { user, v2 } = prepare(root, 'reference');
    const before = readTree(user);
    const result = syncV2(v2, user);
    assert.equal(result.status, 'synced');
    return { before, after: readTree(user), conflicts: result.conflicts };
}

function subtree(tree, dir) {
    return Object.fromEntries(Object.entries(tree).filter(([file]) => file.startsWith(`${dir}/`)));
}

function isDeepEqual(a, b) {
    try {
        assert.deepEqual(a, b);
        return true;
    } catch {
        return false;
    }
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

function hasStaging(user) {
    return fs.readdirSync(user).some(name => name.startsWith('.fntv-sync-'));
}

module.exports = {
    MANAGED_DIRS,
    RECORD,
    prepare,
    syncV2,
    referenceRun,
    subtree,
    assertWholeManagedDirs,
    hasStaging,
};
