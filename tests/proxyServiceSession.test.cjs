const test = require('node:test');
const assert = require('node:assert/strict');
const { startFakeFnMedia } = require('./helpers/fakeFnMedia.cjs');
const { MEDIA, startProxy, get, sessionInput } = require('./helpers/proxyService.cjs');

test('a missing session or a malformed sourceIndex is rejected with 400', async (t) => {
    const nas = await startFakeFnMedia(t, { media: { 'media-1': MEDIA }, streams: { 'item-1': ['media-1'] } });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    for (const query of ['', '?session=', `?session=${session}&sourceIndex=abc`, `?session=${session}&sourceIndex=2147483648`]) {
        const response = await get(service, `/api/v1/playvideo/item-1${query}`);
        assert.equal(response.status, 400, query);
        assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
        assert.deepEqual(JSON.parse(response.body.toString()), { error: 'Invalid parameters' });
    }
    assert.equal(nas.requests.length, 0);
});

test('an unknown session or an item outside the session is rejected with 401', async (t) => {
    const nas = await startFakeFnMedia(t, { media: { 'media-1': MEDIA }, streams: { 'item-1': ['media-1'], 'item-2': ['media-1'] } });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    for (const requestPath of [`/api/v1/playvideo/item-1?session=${'0'.repeat(64)}`, `/api/v1/playvideo/item-2?session=${session}`]) {
        const response = await get(service, requestPath);
        assert.equal(response.status, 401);
        assert.deepEqual(JSON.parse(response.body.toString()), { error: 'Invalid playback session' });
    }
    assert.equal(nas.requests.length, 0);
});

test('query fields do not override the item in the path', async (t) => {
    const nas = await startFakeFnMedia(t, { media: { 'media-1': MEDIA }, streams: { 'item-1': ['media-1'], 'item-2': ['media-1'] } });
    const { service } = await startProxy(t);
    const onlyItem1 = service.createPlaybackSession(sessionInput(nas));
    const onlyItem2 = service.createPlaybackSession(sessionInput(nas, { itemGuids: ['item-2'] }));

    const allowed = await get(service, `/api/v1/playvideo/item-1?session=${onlyItem1}&ItemGuid=item-2&itemGuid=item-2`);
    const rejected = await get(service, `/api/v1/playvideo/item-1?session=${onlyItem2}&ItemGuid=item-2&itemGuid=item-2`);

    assert.equal(allowed.status, 200);
    assert.equal(rejected.status, 401);
    const listPaths = nas.requests.filter((r) => r.path.startsWith('/v/api/v1/stream/list/')).map((r) => r.path);
    assert.deepEqual(listPaths, ['/v/api/v1/stream/list/item-1']);
});

test('a session expires 24 hours after its last use and each use extends it', async (t) => {
    const nas = await startFakeFnMedia(t, { media: { 'media-1': MEDIA }, streams: { 'item-1': ['media-1'] } });
    const { service } = await startProxy(t);
    t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 0, 1) });
    const hour = 60 * 60 * 1000;
    const session = service.createPlaybackSession(sessionInput(nas));
    const play = () => get(service, `/api/v1/playvideo/item-1?session=${session}`);

    t.mock.timers.tick(23 * hour);
    assert.equal((await play()).status, 200);
    t.mock.timers.tick(24 * hour);
    assert.equal((await play()).status, 200, 'exactly 24 hours after the last use is still valid');
    t.mock.timers.tick(24 * hour + 1);
    assert.equal((await play()).status, 401);
});

test('createPlaybackSession rejects invalid input with the Go error messages', async (t) => {
    const nas = await startFakeFnMedia(t);
    const { service } = await startProxy(t);
    const cases = [
        [{ token: '' }, 'missing required session parameters'],
        [{ account: '' }, 'missing required session parameters'],
        [{ domain: '' }, 'missing required session parameters'],
        [{ itemGuids: [] }, 'missing required session parameters'],
        [{ itemGuids: undefined }, 'missing required session parameters'],
        [{ itemGuids: Array.from({ length: 10001 }, (_, i) => `item-${i}`) }, 'too many playlist items'],
        [{ accessCookie: 'a=1\r\nX-Injected: yes' }, 'invalid access cookie'],
        [{ accessCookie: `a=${'x'.repeat(16383)}` }, 'invalid access cookie'],
        [{ itemGuids: ['item-1', ''] }, 'empty playlist item'],
    ];
    for (const [overrides, message] of cases) {
        assert.throws(() => service.createPlaybackSession(sessionInput(nas, overrides)), { message }, Object.keys(overrides)[0]);
    }

    const first = service.createPlaybackSession(sessionInput(nas, {
        itemGuids: [...Array.from({ length: 9999 }, (_, i) => `item-${i}`), 'item-0'],
        accessCookie: `a=${'x'.repeat(16382)}`,
    }));
    const second = service.createPlaybackSession(sessionInput(nas, { accessCookie: undefined }));
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.match(second, /^[a-f0-9]{64}$/);
    assert.notEqual(first, second);
});

test('logs never contain the playback session, the token or the access grant', async (t) => {
    const nas = await startFakeFnMedia(t, { media: { 'media-1': MEDIA }, streams: { 'item-1': ['media-1'] } });
    const { service, logs } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    await get(service, `/api/v1/playvideo/item-1?session=${session}`, { Range: 'bytes=0-9' });
    await get(service, `/api/v1/playvideo/item-2?session=${session}`);
    await get(service, `/nope?session=${session}`);

    assert.ok(logs.length > 0);
    const text = logs.join('\n');
    for (const secret of [session, 'nas-token', 'gateway=granted']) assert.ok(!text.includes(secret), secret);
});
