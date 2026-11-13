const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { root } = require('./helpers/workflowSteps.cjs');

// 冒烟测试用 ::notice:: 等 annotation 把结果显示在 GitHub 上，GitHub 只认从行首开始的 annotation。

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
