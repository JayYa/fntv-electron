const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const { assertExitedCleanly } = require('./helpers/childProcess.cjs');

test('a child process that could not start is reported with its spawn error', () => {
    const result = spawnSync('fntv-no-such-executable', [], { encoding: 'utf8' });

    assert.throws(() => assertExitedCleanly(result), error => {
        assert.match(String(error.message), /ENOENT/);
        assert.notEqual(error.code, 'ERR_INVALID_ARG_TYPE');
        return true;
    });
});

test('a child process that exits non-zero is reported with its stderr', () => {
    const result = spawnSync(process.execPath, ['-e', 'console.error("boom"); process.exit(3)'], { encoding: 'utf8' });

    assert.throws(() => assertExitedCleanly(result), /boom/);
});

test('a child process that exits with 0 passes', () => {
    assertExitedCleanly(spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' }));
});
