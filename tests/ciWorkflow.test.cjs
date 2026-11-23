const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { posixPath, runStep, workflow } = require('./helpers/workflowSteps.cjs');
const { lines, stub, tempDir } = require('./helpers/ciCache.cjs');

const root = path.resolve(__dirname, '..');

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

test('ci.yml also runs on pushes to main, and the file size check only on pull requests', () => {
    const ci = workflow('ci.yml');
    assert.deepEqual(Object.keys(ci.on).sort(), ['pull_request', 'push']);
    assert.deepEqual(ci.on.push, { branches: ['main'] });
    assert.equal(ci.on.pull_request, null);
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
