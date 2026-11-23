const assert = require('node:assert/strict');

function assertExitedCleanly(result) {
    assert.ifError(result.error);
    assert.equal(result.status, 0, String(result.stderr));
}

module.exports = { assertExitedCleanly };
