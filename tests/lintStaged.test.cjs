const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isLintTarget, lintEntries, lintTargets } = require('../scripts/lint-staged.cjs');

const root = path.join(__dirname, '..');

test('lints the same paths as pnpm run lint', () => {
    const targets = lintTargets();
    assert.deepEqual(targets, ['src', 'resource/login', 'tests', 'scripts', 'lint', 'eslint.config.mjs']);
    for (const file of ['src/main/a.ts', 'tests/a.test.cjs', 'scripts/a.cjs', 'lint/a.mjs', 'eslint.config.mjs', 'resource/login/a.js']) {
        assert.ok(isLintTarget(file, targets), file);
    }
    for (const file of ['docs/a.js', 'dest/main.js', 'src/main/a.json', 'srcx/a.ts', 'resource/other/a.js']) {
        assert.ok(!isLintTarget(file, targets), file);
    }
});

test('rejects staged content that does not parse', async () => {
    const { errorCount, report } = await lintEntries([{ file: 'tests/broken.test.cjs', content: "const s = 'a\nb';\n" }]);
    assert.ok(errorCount > 0);
    assert.match(report, /broken\.test\.cjs/);
});

test('rejects a staged lint violation', async () => {
    const content = "import * as log from './logger';\nexport function f(baseUrl: string): void {\n    log.info(`登录 ${baseUrl}`);\n}\n";
    const { errorCount, report } = await lintEntries([{ file: 'src/main/example.ts', content }]);
    assert.equal(errorCount, 1);
    assert.match(report, /nas\/no-address-log/);
});

test('accepts clean staged content', async () => {
    const { errorCount } = await lintEntries([{ file: 'src/main/example.ts', content: 'export const a = 1;\n' }]);
    assert.equal(errorCount, 0);
});

test('the pre-commit hook runs the staged lint after the file size check', () => {
    const hook = fs.readFileSync(path.join(root, '.githooks', 'pre-commit'), 'utf8');
    assert.match(hook, /node scripts\/check-file-size\.cjs \|\| status=1\nnode scripts\/lint-staged\.cjs \|\| status=1\nexit \$status/);
});
