const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { posixPath, root, runStep, workflow } = require('./helpers/workflowSteps.cjs');
const { lines, stub, tempDir } = require('./helpers/ciCache.cjs');
const check = require('../scripts/check.cjs');

// pnpm run check 是改完代码后的验证入口，本地和 ci.yml 跑同一条命令（2026-11-14）。
// 分支保护只要求 ci.yml 的 Check，它汇总所有必需 job 的结果。

function commands(steps) {
    return steps.map(step => step.skipped ? `${step.name}: skipped` : `${step.name}: ${[path.basename(step.file), ...step.args].join(' ')}`);
}

test('pnpm run check runs the file size check, lint, knip and the tests in order', () => {
    const { scripts, devDependencies } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(scripts.check, 'node scripts/check.cjs');
    assert.equal(scripts.knip, 'knip');
    assert.match(devDependencies.knip, /^\d+\.\d+\.\d+$/, 'knip is pinned to an exact version');

    const node = path.basename(process.execPath);
    assert.deepEqual(commands(check.stepsFor(check.parseArgs([]))), [
        `file-size: ${node} scripts/check-file-size.cjs --base origin/main`,
        'lint: pnpm run lint',
        'knip: pnpm run knip',
        'test: pnpm test',
    ]);
    assert.equal(commands(check.stepsFor(check.parseArgs(['--base', 'HEAD^1'])))[0], `file-size: ${node} scripts/check-file-size.cjs --base HEAD^1`);
    assert.equal(commands(check.stepsFor(check.parseArgs(['--no-file-size'])))[0], 'file-size: skipped');
    assert.throws(() => check.parseArgs(['--base']), /用法/);
    assert.throws(() => check.parseArgs(['--fix']), /用法/);
});

test('a failed step does not stop the later ones and fails the summary', () => {
    const steps = check.stepsFor({ base: null });
    const ran = [];
    const results = check.runSteps(steps, (file, args) => {
        ran.push(args.join(' '));
        return args.includes('lint') ? 1 : 0;
    }, () => {});
    assert.deepEqual(ran, ['run lint', 'run knip', 'test']);
    assert.deepEqual(results.map(({ name, result }) => `${name} ${result}`), ['file-size skipped', 'lint failed', 'knip passed', 'test passed']);
    const text = check.summary(results);
    assert.match(text, /file-size\s+skipped\s+--no-file-size/);
    assert.match(text, /check failed: lint\n$/);
    assert.match(check.summary(results.filter(({ result }) => result !== 'failed')), /check passed\n$/);
});

// 在临时目录里运行 ci.yml 的 Run checks，pnpm 换成记录参数的桩。
function runChecks(t, fileSize) {
    const dir = tempDir(t, 'fntv-ci-check-');
    const bin = path.join(dir, 'bin');
    const calls = path.join(dir, 'calls');
    fs.mkdirSync(bin);
    fs.writeFileSync(calls, '');
    stub(bin, 'pnpm', calls, 'exit 0');
    const result = runStep(t, workflow('ci.yml').jobs.test, step => step.name === 'Run checks', {
        PATH: `${posixPath(bin)}:/usr/bin:${process.env.PATH}`,
        FILE_SIZE: fileSize,
    });
    return { result, calls: lines(calls) };
}

test('ci.yml runs pnpm run check, with the file size check only on the Linux cell of a pull request', t => {
    const job = workflow('ci.yml').jobs.test;
    assert.deepEqual(job.strategy.matrix.os, ['ubuntu-latest', 'windows-latest', 'macos-latest']);
    // 只调用 pnpm run check，不再单独写 lint、knip、测试的步骤。
    for (const script of ['lint', 'knip', 'test']) {
        assert.ok(!job.steps.some(step => new RegExp(`pnpm (run )?${script}\\b`).test(step.run ?? '')), `ci.yml runs ${script} outside pnpm run check`);
    }
    assert.equal(workflow('ci.yml').jobs['file-size'], undefined, 'the file size check is part of pnpm run check');
    // PR 上检出的是合并提交，HEAD^1 是 base；文件大小检查要拿到它。
    const checkout = job.steps.find(step => /^actions\/checkout@/.test(step.uses ?? ''));
    assert.equal(checkout.with['fetch-depth'], 2);
    const run = job.steps.find(step => step.name === 'Run checks');
    assert.equal(run.env.FILE_SIZE, "${{ matrix.os == 'ubuntu-latest' && github.event_name == 'pull_request' }}");

    for (const [fileSize, expected] of [['true', 'run check --base HEAD^1'], ['false', 'run check --no-file-size']]) {
        const { result, calls } = runChecks(t, fileSize);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.deepEqual(calls, [expected]);
    }
});

test('CLAUDE.md names the verification command and the real smoke artifacts', () => {
    const doc = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
    assert.match(doc, /`pnpm run check`/);
    assert.match(doc, /gh run view <run-id> --log-failed/);
    // 冒烟 artifact 叫 smoke-<目标>（build-and-smoke.yml），目标来自 tests/smoke/targets.cjs。
    const upload = workflow('build-and-smoke.yml').jobs.smoke.steps.find(step => step.name === 'Upload screenshot and logs');
    assert.equal(upload.with.name, 'smoke-${{ matrix.target }}');
    const { TARGETS } = require('./smoke/targets.cjs');
    for (const target of Object.keys(TARGETS)) assert.ok(doc.includes(`\`${target}\``), `CLAUDE.md does not list ${target}`);
    for (const platform of ['windows', 'macos', 'linux']) assert.ok(doc.includes(`\`${platform}-build\``), `CLAUDE.md does not list ${platform}-build`);
});

function runCheckJob(t, results) {
    return runStep(t, workflow('ci.yml').jobs.check, () => true, { RESULTS: results });
}

test('the Check job needs every other ci.yml job and fails when one fails or is cancelled', t => {
    const ci = workflow('ci.yml');
    const job = ci.jobs.check;
    assert.equal(job.name, 'Check');
    assert.equal(job.if, 'always()');
    assert.deepEqual([...job.needs].sort(), Object.keys(ci.jobs).filter(id => id !== 'check').sort());
    assert.equal(job.steps[0].env.RESULTS, "${{ join(needs.*.result, ' ') }}");

    assert.equal(runCheckJob(t, 'success').status, 0);
    assert.equal(runCheckJob(t, 'success skipped').status, 0);
    assert.notEqual(runCheckJob(t, 'success failure').status, 0);
    assert.notEqual(runCheckJob(t, 'cancelled success').status, 0);
});
