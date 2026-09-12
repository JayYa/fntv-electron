const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyMenuAction } = require('../dest/preload/core/menuAction.js');

test('classifies the two play menu labels', () => {
    assert.equal(classifyMenuAction('继续播放'), 'continue');
    assert.equal(classifyMenuAction('从头开始播放'), 'restart');
});

test('normalizes surrounding and inner whitespace', () => {
    assert.equal(classifyMenuAction('  继续播放\n'), 'continue');
    assert.equal(classifyMenuAction('继续 播放'), 'continue');
    assert.equal(classifyMenuAction('从头\t开始 播放 '), 'restart');
});

test('returns null for non-play menu labels', () => {
    assert.equal(classifyMenuAction('移除'), null);
    assert.equal(classifyMenuAction('删除'), null);
    assert.equal(classifyMenuAction('播放'), null);
    assert.equal(classifyMenuAction('立即播放'), null);
    assert.equal(classifyMenuAction('继续播放全部'), null);
    assert.equal(classifyMenuAction('Play'), null);
});

test('returns null for empty or missing labels', () => {
    assert.equal(classifyMenuAction(''), null);
    assert.equal(classifyMenuAction('   '), null);
    assert.equal(classifyMenuAction(null), null);
    assert.equal(classifyMenuAction(undefined), null);
});
