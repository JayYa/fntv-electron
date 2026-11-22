const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
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

const META = `a b^c&d%PATH%'q'`;

function checkSandbox(t) {
    const dir = tempDir(t, 'fntv-check-run-');
    const tools = path.join(dir, META);
    const calls = path.join(dir, 'calls.jsonl');
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.mkdirSync(tools);
    fs.copyFileSync(path.join(root, 'scripts', 'check.cjs'), path.join(dir, 'scripts', 'check.cjs'));
    const recorder = from => `require('node:fs').appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(${from})) + '\\n');\n`;
    fs.writeFileSync(path.join(dir, 'scripts', 'check-file-size.cjs'), recorder(2));
    return {
        tools,
        pnpm(name, prefix = '') {
            const entry = path.join(tools, name);
            fs.writeFileSync(entry, `${prefix}${recorder(1)}`, { mode: 0o755 });
            return entry;
        },
        run(args, npmExecpath) {
            const env = { ...process.env };
            delete env.npm_execpath;
            if (npmExecpath) env.npm_execpath = npmExecpath;
            return spawnSync(process.execPath, ['scripts/check.cjs', ...args], { cwd: dir, env, encoding: 'utf8' });
        },
        calls: () => fs.existsSync(calls) ? lines(calls).map(line => JSON.parse(line)) : [],
    };
}

function assertStepsReachedUnchanged(sandbox, entry) {
    const ref = `${META}"x"`;
    const result = sandbox.run(['--base', ref], entry);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(sandbox.calls(), [
        ['--base', ref],
        [entry, 'run', 'lint'],
        [entry, 'run', 'knip'],
        [entry, 'test'],
    ]);
    assert.match(result.stdout, /^== lint: pnpm run lint$/m);
    assert.match(result.stdout, /check passed\n$/);
}

test('every step reaches its program with the arguments unchanged, without a shell', t => {
    const sandbox = checkSandbox(t);
    assertStepsReachedUnchanged(sandbox, sandbox.pnpm('pnpm.cjs'));
});

test('a native pnpm binary without an extension runs directly', { skip: process.platform === 'win32' }, t => {
    const sandbox = checkSandbox(t);
    assertStepsReachedUnchanged(sandbox, sandbox.pnpm('pnpm', `#!${process.execPath}\n`));
});

test('node scripts/check.cjs without npm_execpath stops before running any step', t => {
    const sandbox = checkSandbox(t);
    const result = sandbox.run([]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /npm_execpath 未设置.*请用 pnpm run check 运行/);
    assert.equal(result.stdout, '');
    assert.deepEqual(sandbox.calls(), []);
});

test('npm run check is refused instead of running the steps through npm', t => {
    const sandbox = checkSandbox(t);
    for (const name of ['npm-cli.js', 'npm', 'yarn.js']) {
        const result = sandbox.run([], sandbox.pnpm(name));
        assert.equal(result.status, 2, name);
        assert.match(result.stderr, /不是 pnpm，请用 pnpm run check 运行/, name);
        assert.equal(result.stdout, '', name);
    }
    assert.deepEqual(sandbox.calls(), []);
});

test('a pnpm .cmd entry is refused on Windows, since it only runs through a shell', { skip: process.platform !== 'win32' }, t => {
    const sandbox = checkSandbox(t);
    const result = sandbox.run([], sandbox.pnpm('pnpm.cmd'));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /不经 shell 无法运行，请用 pnpm run check 运行/);
    assert.deepEqual(sandbox.calls(), []);
});

test('a failed step does not stop the later ones and fails the summary', async () => {
    const steps = check.stepsFor({ base: null });
    const ran = [];
    const results = await check.runSteps(steps, async (file, args) => {
        ran.push(args.join(' '));
        return { status: args.includes('lint') ? 1 : 0, output: '' };
    }, () => {});
    assert.deepEqual(ran, ['run lint', 'run knip', 'test']);
    assert.deepEqual(results.map(({ name, result }) => `${name} ${result}`), ['file-size skipped', 'lint failed', 'knip passed', 'test passed']);
    const text = check.summary(results);
    assert.match(text, /file-size\s+skipped\s+--no-file-size/);
    assert.match(text, /check failed: lint（完整输出见 check\.log）\n$/);
    assert.match(check.summary(results.filter(({ result }) => result !== 'failed')), /check passed\n$/);
});

test('the summary shows why each failed step failed and check.log keeps every step output', async () => {
    const outputs = {
        lint: '\x1b[4msrc/a.ts\x1b[24m\n  1:1  error  bad  eqeqeq\n',
        knip: 'all good\n',
        test: [
            '✔ passes (1ms)',
            '[INFO] noisy log line',
            '✖ breaks (2ms)',
            'ℹ tests 2',
            '✖ failing tests:',
            '',
            'test at tests/a.test.cjs:3:1',
            '✖ breaks (2ms)',
            '  AssertionError: expected 1 to equal 2',
            '',
        ].join('\n'),
    };
    const results = await check.runSteps(check.stepsFor({ base: null }), async (file, args) => {
        const name = args.includes('lint') ? 'lint' : args.includes('knip') ? 'knip' : 'test';
        return { status: name === 'knip' ? 0 : 1, output: outputs[name] };
    }, () => {});

    const text = check.summary(results);
    assert.match(text, /-- lint 失败：\nsrc\/a\.ts\n {2}1:1 {2}error {2}bad {2}eqeqeq\n/);
    assert.match(text, /-- test 失败：\n\ntest at tests\/a\.test\.cjs:3:1\n✖ breaks \(2ms\)\n {2}AssertionError: expected 1 to equal 2\n/);
    assert.doesNotMatch(text, /noisy log line|all good|knip 失败/);
    assert.match(text, /check failed: lint, test/);

    const log = check.logText(results);
    for (const output of ['all good', 'noisy log line', 'src/a.ts']) assert.ok(log.includes(output), output);
    assert.match(log, /^== lint: pnpm run lint（failed）$/m);
});

test('a long failure detail is cut and points to check.log', async () => {
    const output = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const [result] = await check.runSteps([{ name: 'lint', file: 'pnpm', args: ['run', 'lint'] }], async () => ({ status: 1, output }), () => {});
    const text = check.summary([result]);
    assert.match(text, /line 59\n…另有 40 行，见 check\.log\n/);
    assert.doesNotMatch(text, /line 60\n/);
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

test('build-and-smoke.yml names each smoke artifact smoke-<target>', () => {
    const upload = workflow('build-and-smoke.yml').jobs.smoke.steps.find(step => step.name === 'Upload screenshot and logs');
    assert.equal(upload.with.name, 'smoke-${{ matrix.target }}');
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
