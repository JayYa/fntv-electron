const test = require('node:test');
const assert = require('node:assert/strict');
const { maskLogLine } = require('../dest/modules/logger/masking.js');
const { LogLevel } = require('../dest/modules/logger/config.js');

test('masks playback session capabilities in logged URLs', () => {
    const capability = 'a'.repeat(64);
    const masked = maskLogLine(LogLevel.INFO, `http://127.0.0.1/play?session=${capability}`, []);
    assert.doesNotMatch(masked, new RegExp(capability));
    assert.match(masked, /session=/);
});
