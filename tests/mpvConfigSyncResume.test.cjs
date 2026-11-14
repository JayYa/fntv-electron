// 同步中途退出（断电、被杀）之后下次启动补完，结果和一次跑完相同。
// 每个场景在用户配置里直接造出退出时会留下的磁盘状态：暂存目录 `.fntv-sync-*` 里半写的文件、
// 建了一半的新插件目录、`target.json` 标记的目录替换（docs/external-runtime.md“用户配置同步”）、移开的旧目录、
// 写进暂存但还没到位的安装记录。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { writeTree, readTree, tempRoot } = require('./helpers/mpvManifestFixture.cjs');
const {
    RECORD, prepare, syncV2, referenceRun, subtree, assertWholeManagedDirs, hasStaging,
} = require('./helpers/mpvUpgradeScenario.cjs');

const STAGING = '.fntv-sync-0123456789ab';

function half(text) {
    return text.slice(0, Math.ceil(text.length / 2));
}

// tree 里 dir 下的文件，路径去掉 dir 前缀。
function inside(tree, dir) {
    return Object.fromEntries(Object.entries(subtree(tree, dir)).map(([file, content]) => [file.slice(dir.length + 1), content]));
}

// 第 n 个暂存项是一次目录替换：new 是建好的新目录，marked 时写了 target.json，movedOld 时旧目录已移进 old。
function swap(user, n, dir, { fresh, marked = true, movedOld = false }) {
    const swapDir = path.join(user, STAGING, String(n));
    fs.mkdirSync(swapDir, { recursive: true });
    if (fresh) writeTree(path.join(swapDir, 'new'), fresh);
    if (marked) fs.writeFileSync(path.join(swapDir, 'target.json'), JSON.stringify(dir));
    if (movedOld) fs.renameSync(path.join(user, ...dir.split('/')), path.join(swapDir, 'old'));
}

// 用户配置里的 dir 已整体换成新版。
function replaced(user, ref, dir) {
    fs.rmSync(path.join(user, ...dir.split('/')), { recursive: true, force: true });
    writeTree(path.join(user, ...dir.split('/')), inside(ref.after, dir));
}

// 除了安装记录，所有文件都已是新版（含删掉归档不再带的文件）。
function everythingButRecord(user, ref) {
    for (const name of fs.readdirSync(user)) {
        if (name !== STAGING) fs.rmSync(path.join(user, name), { recursive: true, force: true });
    }
    writeTree(user, { ...ref.after, [RECORD]: ref.before[RECORD] });
}

const INTERRUPTED = {
    'an empty staging directory': (user) => {
        fs.mkdirSync(path.join(user, STAGING));
    },
    'a config file half copied into staging': (user, ref) => {
        writeTree(path.join(user, STAGING), { 1: half(ref.after['fntv/defaults.conf']) });
    },
    'a new plugin directory half built, not yet marked': (user, ref) => {
        const fresh = inside(ref.after, 'scripts/uosc');
        swap(user, 1, 'scripts/uosc', { fresh: { ...fresh, 'lib/a.lua': half(fresh['lib/a.lua']) }, marked: false });
    },
    'a new plugin directory built and marked, the old one still in place': (user, ref) => {
        swap(user, 1, 'scripts/uosc', { fresh: inside(ref.after, 'scripts/uosc') });
    },
    'the old plugin directory moved away, the new one not yet moved in': (user, ref) => {
        swap(user, 1, 'scripts/uosc', { fresh: inside(ref.after, 'scripts/uosc'), movedOld: true });
    },
    'one plugin directory replaced, the next one with user files moved away': (user, ref) => {
        replaced(user, ref, 'scripts/uosc');
        swap(user, 2, 'scripts/uosc_danmaku', { fresh: inside(ref.after, 'scripts/uosc_danmaku'), movedOld: true });
    },
    'the new plugin directory moved in, the old one not yet deleted': (user, ref) => {
        swap(user, 1, 'scripts/uosc', { movedOld: true });
        writeTree(path.join(user, 'scripts', 'uosc'), inside(ref.after, 'scripts/uosc'));
    },
    'a plugin directory new in this version built and marked, not yet moved in': (user, ref) => {
        replaced(user, ref, 'scripts/uosc');
        replaced(user, ref, 'scripts/uosc_danmaku');
        swap(user, 3, 'scripts/smart_skip', { fresh: inside(ref.after, 'scripts/smart_skip') });
    },
    'every file in place, the install record half written into staging': (user, ref) => {
        everythingButRecord(user, ref);
        writeTree(path.join(user, STAGING), { 7: half(ref.after[RECORD]) });
    },
    'every file in place, the install record written into staging but not moved in': (user, ref) => {
        everythingButRecord(user, ref);
        writeTree(path.join(user, STAGING), { 7: ref.after[RECORD] });
    },
    'the install record in place, the staging directory not yet deleted': (user, ref) => {
        everythingButRecord(user, ref);
        writeTree(user, { [RECORD]: ref.after[RECORD] });
        writeTree(path.join(user, STAGING), { 7: 'leftover' });
    },
};

for (const [name, interrupt] of Object.entries(INTERRUPTED)) {
    test(`a sync interrupted with ${name} is completed by the next start`, (t) => {
        const root = tempRoot(t, 'resume');
        const reference = referenceRun(root);
        const { user, v2 } = prepare(root, 'interrupted');
        interrupt(user, reference);

        const resumed = syncV2(v2, user);

        assert.equal(resumed.status, 'synced');
        assert.deepEqual(resumed.conflicts, reference.conflicts);
        assert.deepEqual(readTree(user), reference.after);
    });

    test(`a start without a usable manifest puts plugin directories back after ${name}`, (t) => {
        const root = tempRoot(t, 'resume-no-manifest');
        const reference = referenceRun(root);
        const { user, v2 } = prepare(root, 'interrupted');
        interrupt(user, reference);
        fs.rmSync(v2.manifestPath);

        const skipped = syncV2(v2, user);

        assert.equal(skipped.reason, 'manifest-missing');
        const tree = readTree(user);
        assertWholeManagedDirs(tree, reference, name);
        assert.equal(tree['input.conf'], 'mine\n');
        assert.equal(hasStaging(user), false);
    });
}
