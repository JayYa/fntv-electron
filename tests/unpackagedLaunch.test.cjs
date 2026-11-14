const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { workflow } = require('./helpers/workflowSteps.cjs');

// ci.yml 三平台在 pnpm run check 之后启动未打包的应用，跑安装包冒烟测试的同一套断言（2026-11-14）。
// 断言本身的运行结果看 CI 的 Launch unpackaged app 步骤，这里只锁住接线。

const root = path.resolve(__dirname, '..');

function steps() {
    const job = workflow('ci.yml').jobs.test;
    const find = name => job.steps.find(step => step.name === name);
    return {
        job,
        index: step => job.steps.indexOf(step),
        checks: find('Run checks'),
        fonts: find('Install Linux display and CJK fonts'),
        launch: find('Launch unpackaged app'),
        upload: find('Upload unpackaged launch artifacts'),
    };
}

test('every ci.yml cell launches the unpackaged app after pnpm run check, with xvfb only on Linux', () => {
    const { job, index, checks, fonts, launch } = steps();
    assert.deepEqual(job.strategy.matrix.os, ['ubuntu-latest', 'windows-latest', 'macos-latest']);
    assert.ok(index(checks) < index(fonts) && index(fonts) < index(launch));
    // 默认条件 success()：check 失败时不再启动，免得在没编译好的 dest/ 上报出误导的错误。
    assert.equal(launch.if, undefined);
    assert.equal(launch['timeout-minutes'], 4);
    assert.match(launch.run, /xvfb-run -a .*node scripts\/smoke-unpackaged\.cjs/);
    assert.match(launch.run, /else\n\s+node scripts\/smoke-unpackaged\.cjs/);
    assert.equal(fonts.if, "runner.os == 'Linux'");
    assert.match(fonts.run, /xvfb/);
    assert.match(fonts.run, /fonts-noto-cjk/);
});

test('a failed launch uploads the screenshot and logs the smoke test wrote', () => {
    const { index, launch, upload } = steps();
    assert.ok(index(launch) < index(upload));
    assert.equal(upload.if, 'failure()');
    assert.match(upload.uses, /^actions\/upload-artifact@[0-9a-f]{40}$/);
    assert.equal(upload.with.name, 'unpackaged-${{ runner.os }}');
    assert.equal(upload.with.path, launch.env.FNTV_SMOKE_ARTIFACTS);
});

test('pnpm run test:smoke:unpackaged compiles before launching, and CLAUDE.md names it with its artifacts', () => {
    const { scripts } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(scripts['test:smoke:unpackaged'], 'pnpm run compile && node scripts/smoke-unpackaged.cjs');
    const doc = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
    assert.match(doc, /`pnpm run test:smoke:unpackaged`/);
    for (const os of ['Linux', 'Windows', 'macOS']) assert.ok(doc.includes(`\`unpackaged-${os}\``), `CLAUDE.md does not list unpackaged-${os}`);
});
