const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { posixPath, runStep, workflow } = require('./helpers/workflowSteps.cjs');
const { lines, stub, tempDir } = require('./helpers/ciCache.cjs');

// ci.yml 的触发和并发，以及 cache-cleanup.yml 在 PR 关闭时删掉它的缓存（2026-11-10）。
// main 上的 pnpm store 和 Electron 下载缓存由 ci.yml 在 push 到 main 时存；预热打包缓存的 cache-warm.yml
// 在 2026-11-14 和打包缓存一起删掉（tests/buildDownloads.test.cjs）。

const root = path.resolve(__dirname, '..');

// 在临时目录里跑某个 step：gh 换成桩，list 是 gh api 列缓存时输出的 "<id>\t<key>" 行。
function runWithGh(t, job, find, env, list = '') {
    const dir = tempDir(t, 'fntv-cache-cleanup-');
    const bin = path.join(dir, 'bin');
    const calls = path.join(dir, 'calls');
    fs.mkdirSync(bin);
    fs.writeFileSync(calls, '');
    fs.writeFileSync(path.join(dir, 'list'), list);
    stub(bin, 'gh', calls, `case " $* " in\n  *" DELETE "*) ;;\n  *) cat "${posixPath(path.join(dir, 'list'))}" ;;\nesac`);
    const result = runStep(t, job, find, {
        PATH: `${posixPath(bin)}:/usr/bin:${process.env.PATH}`,
        REPO: 'JayYa/fntv-electron',
        ...env,
    });
    return { result, calls: lines(calls) };
}

function deleted(calls) {
    return calls.filter(call => call.startsWith('api -X DELETE')).map(call => call.split('/').pop());
}

// PR #207 和 #209 各自的 CI 都通过，合在一起后 main 上 7 项测试失败，到 #210 才发现（2026-11-14）。
test('ci.yml also runs on pushes to main, and the file size check only on pull requests', () => {
    const ci = workflow('ci.yml');
    assert.deepEqual(Object.keys(ci.on).sort(), ['pull_request', 'push']);
    assert.deepEqual(ci.on.push, { branches: ['main'] });
    // 不按 branches 过滤，堆叠 PR 也要跑（CODING_STANDARDS.md）。
    assert.equal(ci.on.pull_request, null);
    // push 上没有 PR 的 base 提交，大小检查只看 PR 改动的文件；它在 test job 的 Run checks 里按事件开关，
    // 运行结果见 tests/standards.test.cjs 的 CI checks the size of files a pull request changes。
    const run = ci.jobs.test.steps.find(step => step.name === 'Run checks');
    assert.match(run.env.FILE_SIZE, /github\.event_name == 'pull_request'/);
    assert.equal(ci.jobs.test.if, undefined);
});

test('a new CI run cancels the older one on the same PR or on main without touching other workflows', () => {
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
