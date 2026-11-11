const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { posixPath, runStep, workflow } = require('./helpers/workflowSteps.cjs');
const { lines, stub, tempDir, writeProject } = require('./helpers/ciCache.cjs');
const downloads = require('../scripts/ci-download-cache.cjs');

// main 上的缓存由 cache-warm.yml 维护：缺 Electron 和打包缓存的平台打包一次，删掉被新 key 取代的旧缓存，
// 依赖文件变了时重建 setup-node 的缓存。PR 关闭时 cache-cleanup.yml 删掉它的缓存（2026-11-10）。

const root = path.resolve(__dirname, '..');
const PACKAGING_KEY = 'packaging-v2-Linux-electron-38.8.6-electron-builder-26.18.0-app-builder-lib-26.18.0';

// 在临时目录里跑某个 step：gh 换成桩，list 是 gh api 列缓存时输出的 "<id>\t<key>" 行。
function runWithGh(t, job, find, env, list = '') {
    const dir = tempDir(t, 'fntv-cache-warm-');
    const bin = path.join(dir, 'bin');
    const calls = path.join(dir, 'calls');
    fs.mkdirSync(bin);
    fs.writeFileSync(calls, '');
    fs.writeFileSync(path.join(dir, 'list'), list);
    stub(bin, 'gh', calls, typeof env.GH === 'string' ? env.GH : `case " $* " in\n  *" DELETE "*) ;;\n  *) cat "${posixPath(path.join(dir, 'list'))}" ;;\nesac`);
    const result = runStep(t, job, find, {
        PATH: `${posixPath(bin)}:/usr/bin:${process.env.PATH}`,
        REPO: 'JayYa/fntv-electron',
        ...env,
    }, cwd => {
        writeProject(cwd);
        fs.mkdirSync(path.join(cwd, 'scripts'));
        fs.copyFileSync(path.join(root, 'scripts', 'ci-download-cache.cjs'), path.join(cwd, 'scripts', 'ci-download-cache.cjs'));
    });
    return { result, calls: lines(calls) };
}

function deleted(calls) {
    return calls.filter(call => call.startsWith('api -X DELETE')).map(call => call.split('/').pop());
}

test('cache-warm.yml builds on main without uploading, only where caches are missing', () => {
    const warm = workflow('cache-warm.yml');
    assert.deepEqual(warm.on.push.branches, ['main']);
    for (const file of ['package.json', 'pnpm-lock.yaml', 'scripts/ci-download-cache.cjs', '.github/workflows/build.yml']) {
        assert.ok(warm.on.push.paths.includes(file), `${file} does not trigger cache-warm.yml`);
    }
    assert.ok(warm.on.schedule && 'workflow_dispatch' in warm.on);
    assert.equal(warm.jobs.missing.if, "github.ref == 'refs/heads/main'");
    assert.equal(warm.jobs.missing.permissions.actions, 'read');
    assert.equal(warm.jobs.warm.uses, './.github/workflows/build.yml');
    assert.equal(warm.jobs.warm.with.upload, false);
    const upload = workflow('build.yml').jobs.build.steps.find(step => step.name === 'Upload build artifacts');
    assert.equal(upload.if, 'inputs.upload');
    assert.equal(workflow('build.yml').on.workflow_call.inputs.upload.default, true);
});

test('cache-warm.yml warms only the platforms missing a cache on main', t => {
    // Linux 两个缓存都有，Windows 缺 packaging，macOS 都缺。
    const present = ['electron-Linux-38.8.6', PACKAGING_KEY, 'electron-Windows-38.8.6'];
    const GH = `case " $* " in\n${present.map(key => `  *" key=${key} "*) echo 1 ;;`).join('\n')}\n  *) echo 0 ;;\nesac`;
    const { result, calls } = runWithGh(t, workflow('cache-warm.yml').jobs.missing, step => step.id === 'missing', { GH, REF: 'refs/heads/main' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(result.outputs.matrix), { include: [
        { platform: 'windows', os: 'windows-latest' },
        { platform: 'macos', os: 'macos-latest' },
    ] });
    assert.equal(calls.length, 6);
    assert.ok(calls.every(call => call.includes('ref=refs/heads/main')));
});

test('a cache is stale only once the current key of the same kind and platform is on main', t => {
    const dir = tempDir(t, 'fntv-stale-caches-');
    writeProject(dir);
    const caches = [
        { id: 1, key: 'electron-Linux-38.8.6' },
        { id: 2, key: 'electron-Linux-38.0.0' },
        { id: 3, key: 'packaging-Linux-electron-38.8.6-electron-builder-26.18.0-app-builder-lib-26.18.0' },
        { id: 4, key: 'packaging-v2-Linux-electron-38.0.0-electron-builder-26.18.0-app-builder-lib-26.18.0' },
        { id: 5, key: 'electron-Windows-38.0.0' },
        { id: 6, key: 'mpv-archive-Linux-783cc16d' },
    ];
    // 新打包 key 还没存：打包缓存一条都不删，旧的还要经 restore-keys 用。
    assert.deepEqual(downloads.staleCaches('Linux', caches, dir).map(cache => cache.id), [2]);
    const withPackaging = [...caches, { id: 7, key: PACKAGING_KEY }];
    assert.deepEqual(downloads.staleCaches('Linux', withPackaging, dir).map(cache => cache.id), [2, 3, 4]);
    assert.deepEqual(downloads.staleCaches('Windows', withPackaging, dir), []);
});

test('cache-warm.yml deletes superseded caches after warming, even when nothing was built', () => {
    const prune = workflow('cache-warm.yml').jobs.prune;
    assert.deepEqual(prune.needs, ['missing', 'warm']);
    assert.equal(prune.if, "${{ !cancelled() && needs.missing.result == 'success' }}");
    assert.equal(prune.permissions.actions, 'write');
});

test('the prune step deletes the stale caches it lists on main', t => {
    const list = ['11\telectron-Linux-38.0.0', '12\telectron-Linux-38.8.6', `13\t${PACKAGING_KEY}`,
        '14\tpackaging-Linux-electron-38.8.6-x', '15\tpackaging-macOS-electron-38.8.6-x', ''].join('\n');
    const { result, calls } = runWithGh(t, workflow('cache-warm.yml').jobs.prune, step => step.id === 'prune', { REF: 'refs/heads/main' }, list);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(calls[0], /--paginate .*ref=refs\/heads\/main/);
    assert.deepEqual(deleted(calls), ['11', '14']);
});

test('the deps job sets up pnpm and Node.js exactly like ci.yml, so the cache keys match', () => {
    const deps = workflow('cache-warm.yml').jobs.deps;
    const ci = workflow('ci.yml').jobs.test;
    assert.equal(deps.if, "github.ref == 'refs/heads/main'");
    assert.deepEqual(deps.strategy.matrix.os, ci.strategy.matrix.os);
    for (const name of ['Setup pnpm', 'Setup Node.js']) {
        const mine = deps.steps.find(step => step.name === name);
        const theirs = ci.steps.find(step => step.name === name);
        assert.deepEqual({ uses: mine.uses, with: mine.with }, { uses: theirs.uses, with: theirs.with }, name);
    }
    assert.ok(deps.steps.some(step => step.run === 'pnpm install --frozen-lockfile'));
    // 只装依赖不跑测试，测试由 PR 上的 ci.yml 跑。
    assert.ok(!deps.steps.some(step => step.run === 'pnpm test'));
    // 不给 ci.yml 加 push: main：每次合并都要跑三平台测试，且预热不了打包缓存。
    assert.deepEqual(Object.keys(workflow('ci.yml').on), ['pull_request']);
});

test('a new push to a PR cancels its older CI run without touching other workflows', () => {
    const { concurrency } = workflow('ci.yml');
    assert.equal(concurrency.group, 'ci-${{ github.ref }}');
    assert.equal(concurrency['cancel-in-progress'], true);
    for (const file of fs.readdirSync(path.join(root, '.github', 'workflows')).filter(name => name !== 'ci.yml')) {
        const group = workflow(file).concurrency?.group ?? '';
        assert.ok(!group.startsWith('ci-'), `${file} shares the ci- concurrency group`);
    }
});

test('cache-cleanup.yml deletes the caches of a closed PR', t => {
    const cleanup = workflow('cache-cleanup.yml');
    assert.deepEqual(cleanup.on.pull_request.types, ['closed']);
    assert.equal(cleanup.permissions.contents, 'read');
    const job = cleanup.jobs.cleanup;
    assert.equal(job.permissions.actions, 'write');
    const step = job.steps[0];
    assert.equal(step.env.REF, 'refs/pull/${{ github.event.pull_request.number }}/merge');
    const { result, calls } = runWithGh(t, job, () => true, { REF: 'refs/pull/151/merge' }, '21\tsetup-go-x\n22\tnode-cache-y\n');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(calls[0], /--paginate .*ref=refs\/pull\/151\/merge/);
    assert.deepEqual(deleted(calls), ['21', '22']);
    const empty = runWithGh(t, job, () => true, { REF: 'refs/pull/152/merge' });
    assert.equal(empty.result.status, 0, empty.result.stdout + empty.result.stderr);
    assert.deepEqual(deleted(empty.calls), []);
});
