const test = require('node:test');
const assert = require('node:assert/strict');
const { TtlCache } = require('../dest/modules/fn_api/core/ttlCache.js');

function fakeClock(start = 1_000_000) {
    const clock = { time: start, now: () => clock.time };
    return clock;
}

test('an entry without an explicit ttl expires after the default ttl', () => {
    const clock = fakeClock();
    const cache = new TtlCache({ defaultTtl: 300, now: clock.now });

    cache.set('key', 'value');
    clock.time += 300_000;
    assert.equal(cache.get('key'), 'value');

    clock.time += 1;
    assert.equal(cache.get('key'), undefined);
});

test('an explicit ttl overrides the default ttl', () => {
    const clock = fakeClock();
    const cache = new TtlCache({ defaultTtl: 300, now: clock.now });

    cache.set('short', 'value', 30);
    cache.set('long', 'value', 600);
    clock.time += 30_001;

    assert.equal(cache.get('short'), undefined);
    assert.equal(cache.get('long'), 'value');
});

test('a ttl of 0 never expires', () => {
    const clock = fakeClock();
    const cache = new TtlCache({ defaultTtl: 300, now: clock.now });

    cache.set('key', 'value', 0);
    clock.time += 365 * 24 * 3600 * 1000;

    assert.equal(cache.get('key'), 'value');
});

test('setting a key again replaces its value and restarts its ttl', () => {
    const clock = fakeClock();
    const cache = new TtlCache({ defaultTtl: 300, now: clock.now });

    cache.set('key', 'old');
    clock.time += 200_000;
    cache.set('key', 'new');
    clock.time += 200_000;

    assert.equal(cache.get('key'), 'new');
});

test('a deleted key is no longer returned', () => {
    const cache = new TtlCache({ defaultTtl: 300 });

    cache.set('key', 'value');
    cache.del('key');
    cache.del('missing');

    assert.equal(cache.get('key'), undefined);
});

test('get returns the stored object itself', () => {
    const cache = new TtlCache({ defaultTtl: 300 });
    const value = { success: true, data: { guid: 'a' } };

    cache.set('key', value);

    assert.equal(cache.get('key'), value);
});

test('a pending promise is shared until it settles and is deleted', async () => {
    // ApiService 用同一个缓存存进行中的请求（promise_<key>，30 秒），请求失败时删掉，不缓存失败。
    const clock = fakeClock();
    const cache = new TtlCache({ defaultTtl: 300, now: clock.now });
    let reject;
    const pending = new Promise((_, rejectPending) => { reject = rejectPending; });
    const request = pending.catch(error => {
        cache.del('promise_key');
        throw error;
    });

    cache.set('promise_key', request, 30);
    assert.equal(cache.get('promise_key'), request);

    reject(new Error('network'));
    await assert.rejects(cache.get('promise_key'), /network/);
    assert.equal(cache.get('promise_key'), undefined);
});
