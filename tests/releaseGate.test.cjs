const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

const { TARGETS } = require('./smoke/targets.cjs');

// 发版门禁：release.yml 的 publish 只在 5 个安装包的冒烟测试都通过后运行，测的就是要上传的那批文件。
// workflow 本身跑不了单测，这里读 workflow 文件，锁住 job 之间的依赖关系，并核对 workflow 里的
// 平台、目标和安装包名与 tests/smoke/targets.cjs 一致，加平台时漏改哪一处这里就会失败。

const root = path.resolve(__dirname, '..');
const BUILD_AND_SMOKE = './.github/workflows/build-and-smoke.yml';
const BUILD = './.github/workflows/build.yml';

function workflow(name) {
    return yaml.load(fs.readFileSync(path.join(root, '.github', 'workflows', name), 'utf8'));
}

function asList(value) {
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
}

// Windows 上 PATH 里的 bash 可能是 WSL，这里用 Git 自带的。
function bash() {
    if (process.platform !== 'win32') return 'bash';
    const gitCore = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
    return path.resolve(gitCore, '..', '..', '..', 'usr', 'bin', 'bash.exe');
}

// 按 GitHub 的方式在临时工作目录里运行 job 的某个 step，返回进程结果和它写进 $GITHUB_OUTPUT 的值。
// prepare 在运行前往工作目录里放文件。
function runStep(t, job, find, env, prepare = () => {}) {
    const step = job.steps.find(find);
    assert.ok(step, `step not found: ${find}`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-release-gate-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const output = path.join(dir, 'output');
    fs.writeFileSync(output, '');
    const cwd = path.join(dir, 'workspace');
    fs.mkdirSync(cwd);
    prepare(cwd);
    const result = spawnSync(bash(), ['-eo', 'pipefail', '-c', step.run], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, PATH: process.platform === 'win32' ? `/usr/bin:${process.env.PATH}` : process.env.PATH, ...env, GITHUB_OUTPUT: output },
    });
    const outputs = Object.fromEntries(fs.readFileSync(output, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
    }));
    return { ...result, outputs };
}

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

// GITHUB_TOKEN 开的 Release PR 不触发 pull_request workflow，所以由 release.yml 在 release-please
// 建好或更新 Release PR 的那次运行里，直接对 PR 的 head 分支构建并跑冒烟测试。
test('a Release PR opened or updated by release-please is smoke tested on its head branch in the same run', () => {
    const release = workflow('release.yml');
    const releasePlease = release.jobs['release-please'];
    assert.equal(releasePlease.outputs.prs_created, '${{ steps.release.outputs.prs_created }}');
    assert.equal(releasePlease.outputs.pr, '${{ steps.release.outputs.pr }}');

    const [[name, job]] = smokeJobsOf(release);
    const selectMatrix = release.jobs[asList(job.needs).find(need => need !== 'release-please')];
    assert.match(selectMatrix.if, /needs\.release-please\.outputs\.prs_created == 'true'/);
    // 发版优先：release_created 时 sha 有值，测打 tag 的提交；否则有 Release PR 时测它的 head 分支；手动触发测当前提交。
    assert.equal(
        job.with.ref,
        "${{ needs.release-please.outputs.sha || (needs.release-please.outputs.prs_created == 'true' && fromJSON(needs.release-please.outputs.pr || '{}').headBranchName) || github.sha }}",
        name
    );
    // 只是 Release PR 时不发布。
    assert.match(release.jobs.publish.if, /needs\.release-please\.outputs\.release_created == 'true'/);
});

test('smoke-test.yml does not claim to run on Release PRs', () => {
    // Release PR 由 GITHUB_TOKEN 创建，smoke-test.yml 的 pull_request 不会被触发。
    const text = fs.readFileSync(path.join(root, '.github', 'workflows', 'smoke-test.yml'), 'utf8');
    assert.doesNotMatch(text, /Release PR，它总会改/);
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
