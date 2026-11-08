const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

const { TARGETS } = require('./smoke/targets.cjs');

// 发版门禁：release.yml 的 publish 只在 5 个安装包的冒烟测试都通过后运行，测的就是要上传的那批文件。
// workflow 本身跑不了单测，这里读 workflow 文件，锁住 job 之间的依赖关系。

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

// 按 GitHub 的方式运行某个 job 里带 id 的 step，返回它写进 $GITHUB_OUTPUT 的值。
function runStepOutputs(job, stepId, env) {
    const step = job.steps.find(s => s.id === stepId);
    assert.ok(step, `step ${stepId} not found`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-release-gate-'));
    try {
        const output = path.join(dir, 'output');
        fs.writeFileSync(output, '');
        const result = spawnSync(bash(), ['-eo', 'pipefail', '-c', step.run], {
            encoding: 'utf8',
            env: { ...process.env, PATH: process.platform === 'win32' ? `/usr/bin:${process.env.PATH}` : process.env.PATH, ...env, GITHUB_OUTPUT: output },
        });
        assert.equal(result.status, 0, result.stderr);
        return Object.fromEntries(fs.readFileSync(output, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
            const index = line.indexOf('=');
            return [line.slice(0, index), line.slice(index + 1)];
        }));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

// build-and-smoke.yml 对一个平台测哪些目标。
function smokeTargetsOf(platform) {
    const outputs = runStepOutputs(workflow('build-and-smoke.yml').jobs['select-targets'], 'targets', { PLATFORM: platform });
    return JSON.parse(outputs['smoke-matrix']).include.map(entry => entry.target);
}

function smokeJobsOf(release) {
    return Object.entries(release.jobs).filter(([, job]) => job.uses === BUILD_AND_SMOKE);
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
    const download = release.jobs.publish.steps.find(step => String(step.uses).startsWith('actions/download-artifact@'));
    // build-and-smoke.yml 经 build.yml 上传 <platform>-build，冒烟测试下载的也是它。
    assert.equal(download.with.pattern, '*-build');
});

test('a release is smoke tested on all five targets', () => {
    const release = workflow('release.yml');
    const [[name, job]] = smokeJobsOf(release);
    // 发版时 push 触发，没有 platform 输入。
    const outputs = runStepOutputs(release.jobs[asList(job.needs).find(need => need !== 'release-please')], 'matrix', { PLATFORM: 'all' });
    const platforms = JSON.parse(outputs.platforms);
    assert.match(job.strategy.matrix.platform, /fromJSON\(needs\.select-matrix\.outputs\.platforms\)/, name);
    assert.deepEqual(platforms.flatMap(smokeTargetsOf).sort(), Object.keys(TARGETS).sort());
    assert.equal(Object.keys(TARGETS).length, 5);
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

test('a Release PR is smoke tested on all five targets', () => {
    const smoke = workflow('smoke-test.yml');
    // release-please 的 Release PR 总会改 package.json 的版本号（release-type 是 node）。
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'release-please-config.json'), 'utf8'))['release-type'], 'node');
    assert.ok(smoke.on.pull_request.paths.includes('package.json'));
    assert.equal(smoke.on.pull_request.branches, undefined);
    const prPlatforms = JSON.parse(smoke.jobs.smoke.strategy.matrix.platform.match(/'(\[(?:"[a-z]+",?)+\])'/)[1]);
    assert.deepEqual(prPlatforms.flatMap(smokeTargetsOf).sort(), Object.keys(TARGETS).sort());
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
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    const result = spawnSync(process.execPath, ['--test', ...flags, file], { encoding: 'utf8', env });

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^::notice::smoke warmup: 1ms$/m);
});
