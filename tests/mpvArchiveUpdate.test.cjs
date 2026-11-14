const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { posixPath, root, runStep, workflow } = require('./helpers/workflowSteps.cjs');
const { lines, stub, tempDir } = require('./helpers/ciCache.cjs');
const { assertArchivePinsConsistent, pinnedArchive, PIN_FILES } = require('./helpers/mpvArchivePins.cjs');
const { archiveFromRelease, isNewerTag, run } = require('../scripts/update-mpv-archive.cjs');

// 自动升级 MPV 归档（2026-11-14）：scripts/update-mpv-archive.cjs 从 Release API 取资产名和 digest，
// 改 mpv-archive.json、README.md、docs/external-runtime.md；update-mpv-archive.yml 定时运行它并开 PR。

const NEW_TAG = 'fntv-mpv-v20261201_093000';
// 资产名故意和 tag 的时间不同：脚本必须用 API 给的名字，不能按 tag 推算。
const NEW_ASSET = 'mpv-package-20261201_013012.zip';
const NEW_SHA = 'ab'.repeat(32);

function release(tag = NEW_TAG, assets = [{ name: NEW_ASSET, digest: `sha256:${NEW_SHA}` }]) {
    return { tag_name: tag, assets: [{ name: 'notes.txt', digest: `sha256:${'0'.repeat(64)}` }, ...assets] };
}

// 仓库三处文件的临时副本。
function copyRepo(t) {
    const dir = tempDir(t, 'fntv-mpv-update-');
    for (const file of PIN_FILES) {
        fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        fs.copyFileSync(path.join(root, file), path.join(dir, file));
    }
    return dir;
}

function snapshot(dir) {
    return PIN_FILES.map(file => fs.readFileSync(path.join(dir, file), 'utf8'));
}

async function runIn(dir, args, rel) {
    const requests = [];
    const output = path.join(dir, 'github-output');
    fs.writeFileSync(output, '');
    const result = await run(args, {
        root: dir,
        env: { GITHUB_OUTPUT: output, GH_TOKEN: 'token' },
        fetch: async (repo, tag, token) => {
            requests.push({ repo, tag, token });
            return rel;
        },
        log: () => {},
    });
    return { result, requests, outputs: Object.fromEntries(lines(output).map(line => line.split('='))) };
}

test('a newer release is pinned in mpv-archive.json, README and docs, and the pins stay consistent', async t => {
    const dir = copyRepo(t);
    const before = pinnedArchive(root);
    const { result, requests, outputs } = await runIn(dir, [], release());

    assert.equal(result.updated, true);
    assert.deepEqual(requests, [{ repo: 'JayYa/fntv-mpv-config', tag: null, token: 'token' }]);
    const after = pinnedArchive(dir);
    assert.equal(after.tag, NEW_TAG);
    assert.equal(after.asset, NEW_ASSET);
    assert.equal(after.sha256, NEW_SHA);
    assert.equal(after.repo, before.repo);
    assertArchivePinsConsistent(dir);
    assert.deepEqual(outputs, { updated: 'true', 'previous-tag': before.tag, tag: NEW_TAG, asset: NEW_ASSET, sha256: NEW_SHA });

    // 只换这三个值，mpv-archive.json 其余部分不动。
    // 改动的文件都不在 .github/workflows 下：GITHUB_TOKEN 推不了改 workflow 的提交（2026-11-14 实际失败过）。
    assert.ok(PIN_FILES.every(file => !file.startsWith('.github/workflows/')), PIN_FILES.join(', '));
    const lineDiff = (a, b) => a.split('\n').filter((line, i) => line !== b.split('\n')[i]);
    assert.equal(lineDiff(fs.readFileSync(path.join(root, PIN_FILES[0]), 'utf8'), snapshot(dir)[0]).length, 3);
});

test('the latest release is ignored unless its tag is newer than the pinned one', async t => {
    const dir = copyRepo(t);
    const before = snapshot(dir);
    const pinned = pinnedArchive(root);
    for (const rel of [
        release(pinned.tag, [{ name: pinned.asset, digest: `sha256:${pinned.sha256}` }]),
        release('fntv-mpv-v20250101_000000'),
    ]) {
        const { result, outputs } = await runIn(dir, [], rel);
        assert.equal(result.updated, false);
        assert.deepEqual(outputs, { updated: 'false', 'previous-tag': pinned.tag });
        assert.deepEqual(snapshot(dir), before);
    }
});

test('--tag pins the requested release even when it is older', async t => {
    const dir = copyRepo(t);
    const old = 'fntv-mpv-v20251001_120000';
    const { result, requests } = await runIn(dir, ['--tag', old], release(old));
    assert.equal(result.updated, true);
    assert.equal(requests[0].tag, old);
    assert.equal(pinnedArchive(dir).tag, old);
    assertArchivePinsConsistent(dir);
    await assert.rejects(runIn(dir, ['--tag', 'fntv-mpv-v20251002_120000'], release(NEW_TAG)), /请求的是/);
});

test('a release without exactly one zip asset with a sha256 digest is rejected', () => {
    assert.deepEqual(archiveFromRelease(release()), { tag: NEW_TAG, asset: NEW_ASSET, sha256: NEW_SHA });
    assert.throws(() => archiveFromRelease(release(NEW_TAG, [])), /恰好有一个 \.zip/);
    assert.throws(() => archiveFromRelease(release(NEW_TAG, [
        { name: 'a.zip', digest: `sha256:${NEW_SHA}` }, { name: 'b.zip', digest: `sha256:${NEW_SHA}` },
    ])), /a\.zip, b\.zip/);
    assert.throws(() => archiveFromRelease(release(NEW_TAG, [{ name: NEW_ASSET, digest: null }])), /digest/);
    assert.throws(() => archiveFromRelease(release(NEW_TAG, [{ name: 'a b$.zip', digest: `sha256:${NEW_SHA}` }])), /不允许的字符/);
    assert.throws(() => archiveFromRelease(release('v1.0.0')), /tag 格式/);
});

test('a failed update leaves all three files untouched', async t => {
    const dir = copyRepo(t);
    const runtimeDoc = path.join(dir, PIN_FILES[2]);
    fs.writeFileSync(runtimeDoc, '没有 tag');
    const before = snapshot(dir);
    await assert.rejects(runIn(dir, [], release()), /docs\/external-runtime\.md 里找不到 tag/);
    assert.deepEqual(snapshot(dir), before);
});

test('tags compare by their timestamp', () => {
    assert.equal(isNewerTag('fntv-mpv-v20261110_224320', 'fntv-mpv-v20261110_224319'), true);
    assert.equal(isNewerTag('fntv-mpv-v20261110_224319', 'fntv-mpv-v20261110_224319'), false);
    assert.equal(isNewerTag('fntv-mpv-v20251231_235959', 'fntv-mpv-v20261110_224319'), false);
});

// workflow：定时加手动，只从 main 运行，tag 经 env 传给脚本，开 PR 用 GITHUB_TOKEN。
function updateJob() {
    return workflow('update-mpv-archive.yml').jobs.update;
}

test('update-mpv-archive.yml runs on a schedule and by hand, from main, with the script', () => {
    const wf = workflow('update-mpv-archive.yml');
    assert.ok(wf.on.schedule?.length, 'no schedule');
    assert.equal(wf.on.workflow_dispatch.inputs.tag.required, false);
    assert.deepEqual(wf.permissions, { contents: 'read' });
    const job = updateJob();
    assert.equal(job.if, "github.ref == 'refs/heads/main'");
    assert.deepEqual(job.permissions, { contents: 'write', 'pull-requests': 'write' });
    const pin = job.steps.find(step => step.id === 'pin');
    assert.equal(pin.env.TAG, '${{ inputs.tag }}');
    assert.doesNotMatch(pin.run, /\$\{\{/, 'inputs must reach the script through env');
    assert.match(pin.run, /node scripts\/update-mpv-archive\.cjs --tag "\$TAG"/);
    const pr = job.steps.find(step => step.name === 'Open or update the pull request');
    assert.equal(pr.if, "steps.pin.outputs.updated == 'true'");
    assert.doesNotMatch(pr.run, /\$\{\{/);
    assert.equal(pr.env.GH_TOKEN, '${{ github.token }}');
});

// 升级 PR 只改 PIN_FILES，Smoke Test 要因为它们触发，才会用新归档构建并测试安装包。
test('the smoke test runs on a PR that changes the pinned MPV archive', () => {
    assert.ok(workflow('smoke-test.yml').on.pull_request.paths.includes(PIN_FILES[0]));
});

// 用桩 git 和 gh 运行开 PR 的步骤。openPr 是 gh pr list 返回的 PR 号，sameFiles 表示远端分支上三处文件已经一样。
function runPrStep(t, { openPr = '', sameFiles = false } = {}) {
    const dir = tempDir(t, 'fntv-mpv-pr-');
    const bin = path.join(dir, 'bin');
    const calls = path.join(dir, 'calls');
    fs.mkdirSync(bin);
    fs.writeFileSync(calls, '');
    stub(bin, 'gh', calls, `case "$*" in\n  "pr list"*) echo "${openPr}" ;;\nesac`);
    stub(bin, 'git', calls, `case "$1" in\n  diff) exit ${sameFiles ? 0 : 1} ;;\nesac`);
    const result = runStep(t, updateJob(), step => step.name === 'Open or update the pull request', {
        PATH: `${posixPath(bin)}:/usr/bin:${process.env.PATH}`,
        RUNNER_TEMP: posixPath(dir),
        BRANCH: 'automation/mpv-archive',
        REPO: 'JayYa/fntv-electron',
        PREVIOUS_TAG: 'fntv-mpv-v20261110_224319',
        TAG: NEW_TAG,
        ASSET: NEW_ASSET,
        SHA256: NEW_SHA,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const body = path.join(dir, 'mpv-archive-pr.md');
    return { calls: lines(calls), body: fs.existsSync(body) ? fs.readFileSync(body, 'utf8') : '' };
}

test('a new archive opens a PR from the automation branch against main', t => {
    const { calls, body } = runPrStep(t);
    assert.ok(calls.includes('push --force origin HEAD:refs/heads/automation/mpv-archive'), calls.join('\n'));
    const create = calls.find(call => call.startsWith('pr create'));
    assert.match(create, /--base main --head automation\/mpv-archive --title fix\(deps\): 附带的 MPV 和插件更新到 fntv-mpv-v20261201_093000/);
    assert.match(calls.find(call => call.startsWith('commit')), /-- mpv-archive\.json README\.md docs\/external-runtime\.md$/);
    assert.ok(body.includes(NEW_ASSET) && body.includes(NEW_SHA) && body.includes('Approve workflows to run'), body);
});

test('an open PR is updated in place, and not pushed again when it already pins the archive', t => {
    const edited = runPrStep(t, { openPr: '42' }).calls;
    assert.ok(edited.some(call => call.startsWith('pr edit 42')), edited.join('\n'));
    assert.ok(!edited.some(call => call.startsWith('pr create')));

    // 每次推送都要维护者重新批准 CI，内容没变就不推。
    const skipped = runPrStep(t, { openPr: '42', sameFiles: true }).calls;
    assert.ok(!skipped.some(call => call.startsWith('push') || call.startsWith('commit') || call.startsWith('pr edit')), skipped.join('\n'));
});
