const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { TARGETS } = require('./smoke/targets.cjs');
const { asList, assertRestoreAndSave, posixPath, runStep, workflow } = require('./helpers/workflowSteps.cjs');

// 发版门禁：release.yml 的 publish 只在 5 个安装包的冒烟测试都通过后运行，测的就是要上传的那批文件。
// workflow 本身跑不了单测，这里读 workflow 文件，锁住 job 之间的依赖关系，并核对 workflow 里的
// 平台、目标和安装包名与 tests/smoke/targets.cjs 一致，加平台时漏改哪一处这里就会失败。

const root = path.resolve(__dirname, '..');
const BUILD_AND_SMOKE = './.github/workflows/build-and-smoke.yml';
const BUILD = './.github/workflows/build.yml';

function runStepOutputs(t, job, stepId, env) {
    const result = runStep(t, job, step => step.id === stepId, env);
    assert.equal(result.status, 0, result.stderr);
    return result.outputs;
}

// build-and-smoke.yml 对一个平台测哪些目标。
function smokeTargetsOf(t, platform) {
    const outputs = runStepOutputs(t, workflow('build-and-smoke.yml').jobs['select-targets'], 'targets', { PLATFORM: platform });
    return JSON.parse(outputs['smoke-matrix']).include.map(entry => entry.target);
}

function smokeJobsOf(release) {
    return Object.entries(release.jobs).filter(([, job]) => job.uses === BUILD_AND_SMOKE);
}

// targets.cjs 里出现的平台，就是 workflow 里构建和测试的单位。
function platformsOfTargets() {
    return [...new Set(Object.values(TARGETS).map(target => target.platform))].sort();
}

test('publishing a release waits for every build-and-smoke job to succeed', () => {
    const release = workflow('release.yml');
    const smokeJobs = smokeJobsOf(release).map(([name]) => name);
    assert.ok(smokeJobs.length > 0, 'release.yml does not call build-and-smoke.yml');

    const publish = release.jobs.publish;
    const needs = asList(publish.needs);
    for (const name of smokeJobs) {
        assert.ok(needs.includes(name), `publish.needs is missing ${name}`);
        assert.match(publish.if, new RegExp(`needs\\.${name}\\.result == 'success'`), `publish.if does not require ${name} to succeed`);
    }
    // always()、!cancelled() 或 failure() 会让 publish 在冒烟测试失败后照样运行。
    assert.doesNotMatch(publish.if, /always\(\)|cancelled\(\)|failure\(\)/);
});

test('the installers uploaded to the release are the ones the smoke tests ran on', () => {
    const release = workflow('release.yml');
    // 另有一个直接调用 build.yml 的 job 就意味着又构建了一份没经过冒烟测试的安装包。
    for (const [name, job] of Object.entries(release.jobs)) {
        assert.notEqual(job.uses, BUILD, `${name} builds installers without smoke testing them`);
    }
    // 只有一个 build-and-smoke job：同一次运行里再调用一次会上传同名的 <platform>-build，publish 分不清是哪一份。
    assert.equal(smokeJobsOf(release).length, 1);
    const download = release.jobs.publish.steps.find(step => String(step.uses).startsWith('actions/download-artifact@'));
    // build-and-smoke.yml 经 build.yml 上传 <platform>-build，冒烟测试下载的也是它。
    assert.equal(download.with.pattern, '*-build');
});

test('a release is smoke tested on all five targets', t => {
    const release = workflow('release.yml');
    const [[name, job]] = smokeJobsOf(release);
    // 发版时 push 触发，没有 platform 输入。
    const outputs = runStepOutputs(t, release.jobs[asList(job.needs).find(need => need !== 'release-please')], 'matrix', { PLATFORM: 'all' });
    const platforms = JSON.parse(outputs.platforms);
    assert.match(job.strategy.matrix.platform, /fromJSON\(needs\.select-matrix\.outputs\.platforms\)/, name);
    assert.deepEqual(platforms.flatMap(platform => smokeTargetsOf(t, platform)).sort(), Object.keys(TARGETS).sort());
    assert.equal(Object.keys(TARGETS).length, 5);
});

// Release PR 会触发 pull_request workflow（要维护者批准后才运行），它的冒烟测试由 smoke-test.yml 跑，
// release.yml 不对 Release PR 构建（2026-11-08 维护者决定）。release.yml 只在发版和手动触发时构建，
// 构建的是 release-please 打 tag 的提交或当前提交。
test('release.yml builds only for a release or a manual run, never for a Release PR branch', () => {
    const release = workflow('release.yml');
    const releasePlease = release.jobs['release-please'];
    assert.ok(!('prs_created' in releasePlease.outputs), 'release-please exposes prs_created');
    assert.ok(!('pr' in releasePlease.outputs), 'release-please exposes pr');

    const [[name, job]] = smokeJobsOf(release);
    const selectMatrix = release.jobs[asList(job.needs).find(need => need !== 'release-please')];
    assert.doesNotMatch(selectMatrix.if, /prs_created/);
    assert.equal(job.with.ref, '${{ needs.release-please.outputs.sha || github.sha }}', name);
    assert.doesNotMatch(fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8'), /headBranchName|prs_created/);
});

test('a Release PR is smoke tested by smoke-test.yml because it always changes package.json', () => {
    const smoke = workflow('smoke-test.yml');
    const pullRequest = smoke.on.pull_request;
    assert.ok(pullRequest, 'smoke-test.yml has no pull_request trigger');
    // release-please 的 Release PR 改 package.json、.release-please-manifest.json 和 CHANGELOG.md。
    assert.ok(pullRequest.paths.includes('package.json'), 'smoke-test.yml does not run when package.json changes');
    assert.equal(pullRequest.branches, undefined, 'smoke-test.yml filters pull_request by base branch');
    assert.equal(pullRequest['paths-ignore'], undefined);
    // PR 时测全部平台。
    assert.match(smoke.jobs.smoke.strategy.matrix.platform, /'\["linux","macos","windows"\]'/);
});

test('each platform in the workflows smoke tests exactly its targets from targets.cjs', t => {
    const platforms = platformsOfTargets();
    assert.deepEqual(platforms, ['linux', 'macos', 'windows']);
    for (const platform of platforms) {
        const expected = Object.keys(TARGETS).filter(id => TARGETS[id].platform === platform).sort();
        assert.deepEqual(smokeTargetsOf(t, platform).sort(), expected, platform);
    }

    // smoke-test.yml 在 PR 和 all 时测的平台列表，以及两个 workflow 手动触发时可选的平台。
    const smoke = workflow('smoke-test.yml');
    const prPlatforms = JSON.parse(smoke.jobs.smoke.strategy.matrix.platform.match(/'(\[(?:"[a-z]+",?)+\])'/)[1]);
    assert.deepEqual(prPlatforms.sort(), platforms);
    assert.deepEqual(smoke.on.workflow_dispatch.inputs.platform.options.filter(option => option !== 'all').sort(), platforms);
    const releaseOptions = workflow('release.yml').on.workflow_dispatch.inputs.platform.options;
    for (const platform of platforms) {
        assert.ok(releaseOptions.includes(platform), `release.yml workflow_dispatch has no ${platform}`);
    }
});

test('publish checks for exactly one installer per smoke target', t => {
    const publish = workflow('release.yml').jobs.publish;
    const check = step => step.name === 'Check installers';
    // dist 为空时，step 列出它要找的每个安装包名。
    const missing = runStep(t, publish, check, { VERSION: '9.9.9' }, cwd => fs.mkdirSync(path.join(cwd, 'dist')));
    assert.notEqual(missing.status, 0);
    const names = [...missing.stdout.matchAll(/^::error::missing (.+)$/gm)].map(match => match[1]);
    for (const [id, target] of Object.entries(TARGETS)) {
        assert.equal(names.filter(name => target.installerPattern.test(name)).length, 1, `${id}: ${names.join(', ')}`);
    }
    assert.equal(names.length, Object.keys(TARGETS).length, names.join(', '));

    const present = runStep(t, publish, check, { VERSION: '9.9.9' }, cwd => {
        fs.mkdirSync(path.join(cwd, 'dist'));
        for (const name of names) fs.writeFileSync(path.join(cwd, 'dist', name), '');
    });
    assert.equal(present.status, 0, present.stdout + present.stderr);
});

test('running the Release workflow by hand builds and smoke tests but does not publish', () => {
    const release = workflow('release.yml');
    assert.ok('workflow_dispatch' in release.on);
    assert.match(release.jobs['release-please'].if, /github\.event_name == 'push'/);
    // 手动触发时 release-please 被跳过，release_created 为空，publish 跟着跳过。
    assert.match(release.jobs.publish.if, /needs\.release-please\.outputs\.release_created == 'true'/);
    const [, job] = smokeJobsOf(release)[0];
    assert.match(job.if, /!cancelled\(\)/);
});

test('only release-please and publish can write to the repository', () => {
    const release = workflow('release.yml');
    assert.deepEqual(release.permissions, { contents: 'read' });
    assert.deepEqual(release.jobs.publish.permissions, { contents: 'write' });
    for (const [name, job] of Object.entries(release.jobs)) {
        if (name === 'release-please' || name === 'publish') continue;
        assert.ok(!Object.values(job.permissions ?? {}).includes('write'), `${name} has write permissions`);
    }
});

test('smoke test annotations are printed at the start of a line so GitHub picks them up', t => {
    // 默认 reporter 随 Node 版本和输出是否是终端而变，CI 上的 TAP 会在测试输出前加 "# "。
    const script = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts['test:smoke'];
    const flags = script.split(/\s+/).filter(arg => arg.startsWith('--test-'));
    assert.ok(flags.some(flag => flag.startsWith('--test-reporter=')), `test:smoke does not choose a reporter: ${script}`);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-smoke-notice-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'notice.smoke.cjs');
    fs.writeFileSync(file, "require('node:test')('warmup', () => { console.log('::notice::smoke warmup: 1ms'); });\n");
    // 外层 node --test 设的 NODE_TEST_CONTEXT 会让子进程改用内部格式输出，要去掉。
    const { NODE_TEST_CONTEXT: _context, ...env } = process.env;
    const result = spawnSync(process.execPath, ['--test', ...flags, file], { encoding: 'utf8', env });

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^::notice::smoke warmup: 1ms$/m);
});

// MPV 归档按 sha256 缓存：换版本时 key 跟着变，命中缓存也要校验，不通过就重新下载。
function mpvArchiveSteps() {
    const job = workflow('build.yml').jobs.build;
    const cache = job.steps.find(step => step.id === 'mpv-archive-cache');
    const download = job.steps.find(step => step.name === 'Download third-party dependencies');
    const save = job.steps.find(step => step.name === 'Save MPV archive cache');
    return { job, cache, download, save };
}

// 在临时目录里放好缓存的压缩包，用桩代替 curl 和 unzip 运行下载步骤，返回桩被调用的记录。
function runMpvDownload(t, archive, sha256) {
    const { job } = mpvArchiveSteps();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-mpv-archive-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const bin = path.join(dir, 'bin');
    const temp = path.join(dir, 'temp');
    const calls = path.join(dir, 'calls');
    fs.mkdirSync(bin);
    fs.mkdirSync(path.join(temp, 'mpv-archive'), { recursive: true });
    fs.writeFileSync(path.join(temp, 'mpv-archive', 'mpv-config.zip'), archive);
    fs.writeFileSync(calls, '');
    for (const tool of ['curl', 'unzip']) {
        fs.writeFileSync(path.join(bin, tool), `#!/bin/sh\necho ${tool} >> "${posixPath(calls)}"\n`, { mode: 0o755 });
    }
    const result = runStep(t, job, step => step.name === 'Download third-party dependencies', {
        PATH: `${posixPath(bin)}:/usr/bin:${process.env.PATH}`,
        RUNNER_TEMP: posixPath(temp),
        RUNNER_OS: 'Linux',
        MPV_CONFIG_SHA256: sha256,
    });
    return { result, calls: fs.readFileSync(calls, 'utf8').split(/\r?\n/).filter(Boolean) };
}

test('the MPV archive cache key changes with the archive sha256', () => {
    const { job, cache, download } = mpvArchiveSteps();
    assert.ok(cache, 'build.yml has no mpv-archive-cache step');
    assert.match(cache.with.key, /\$\{\{\s*env\.MPV_CONFIG_SHA256\s*\}\}/);
    assert.match(job.env.MPV_CONFIG_SHA256, /^[0-9a-f]{64}$/);
    assert.ok(job.steps.indexOf(cache) < job.steps.indexOf(download), 'cache must be restored before the download step');
    assert.equal(cache.with.path, '${{ runner.temp }}/mpv-archive');
    assert.match(download.run, /\$RUNNER_TEMP\/mpv-archive\/mpv-config\.zip/);
});

test('the MPV archive is cached as soon as it is downloaded and verified', () => {
    // 后面的构建失败也要保住已下载的压缩包。
    const { job, cache, download, save } = mpvArchiveSteps();
    assertRestoreAndSave(job, cache, save, download);
});

test('electron-builder and Electron downloads are cached per lockfile', () => {
    const job = workflow('build.yml').jobs.build;
    const restore = job.steps.find(step => step.id === 'packaging-cache');
    const save = job.steps.find(step => step.name === 'Save packaging download cache');
    const build = job.steps.find(step => step.name === 'Build application');
    assertRestoreAndSave(job, restore, save, build);
    assert.ok(job.steps.indexOf(restore) < job.steps.indexOf(build), 'packaging cache must be restored before the build');
    assert.match(restore.with.key, /\$\{\{\s*runner\.os\s*\}\}/);
    assert.match(restore.with.key, /hashFiles\('pnpm-lock\.yaml'\)/);
    // 打包工具存到 ELECTRON_BUILDER_CACHE；Electron zip 存到 @electron/get 的默认目录，它不读 ELECTRON_CACHE。
    const paths = restore.with.path.trim().split('\n');
    assert.ok(paths.includes(build.env.ELECTRON_BUILDER_CACHE), 'ELECTRON_BUILDER_CACHE is not cached');
    for (const dir of ['~/.cache/electron', '~/Library/Caches/electron', '~/AppData/Local/electron/Cache']) {
        assert.ok(paths.includes(dir), `${dir} is not cached`);
    }
});

test('a cached MPV archive is verified and used without downloading', t => {
    const archive = Buffer.from('cached archive');
    const sha256 = require('node:crypto').createHash('sha256').update(archive).digest('hex');
    const { result, calls } = runMpvDownload(t, archive, sha256);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(calls, ['unzip']);
});

test('a cached MPV archive that fails verification is downloaded again', t => {
    const { result, calls } = runMpvDownload(t, Buffer.from('corrupted archive'), '0'.repeat(64));
    // 桩 curl 不写文件，重新下载后的校验失败，步骤也要失败。
    assert.notEqual(result.status, 0);
    assert.deepEqual(calls, ['curl']);
});
