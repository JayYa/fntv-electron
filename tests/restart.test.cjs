const test = require('node:test');
const assert = require('node:assert/strict');
const { applyRestart } = require('../dest/modules/playback/restart.js');

function makeItem(ts) {
    return {
        itemGuid: 'item-guid',
        title: 'Episode 3',
        tvTitle: 'Some Show',
        seasonNumber: 1,
        episodeNumber: 3,
        ts,
        duration: 2400,
        playLink: 'http://127.0.0.1:1234/play/item-guid',
    };
}

test('restart zeroes ts and keeps every other field unchanged', () => {
    const item = makeItem(1234);
    const result = applyRestart(item, true);

    assert.equal(result.ts, 0);
    assert.deepEqual(result, { ...item, ts: 0 });
    // 不修改传入对象
    assert.equal(item.ts, 1234);
});

test('no restart returns the item as-is', () => {
    const item = makeItem(1234);
    const result = applyRestart(item, false);

    assert.equal(result, item);
    assert.equal(result.ts, 1234);
});

test('restart on an item already at 0 stays at 0', () => {
    const item = makeItem(0);
    const result = applyRestart(item, true);

    assert.equal(result.ts, 0);
    assert.deepEqual(result, item);
});
