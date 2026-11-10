const test = require('node:test');
const assert = require('node:assert/strict');
const { startFakeFnMedia } = require('./helpers/fakeFnMedia.cjs');
const { startProxy, get, sessionInput } = require('./helpers/proxyService.cjs');

function playInfo(skipOpening, skipEnding) {
    return { guid: 'item-1', parent_guid: 'season-1', play_config: { skip_opening: skipOpening, skip_ending: skipEnding } };
}

test('GET skipinfo returns the skip points from the NAS play info in the Go response shape', async (t) => {
    const nas = await startFakeFnMedia(t, { playInfo: { 'item-1': playInfo(85, 120) } });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    const response = await get(service, `/api/v1/skipinfo/item-1?session=${session}`);

    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(response.body.toString(), '{"code":0,"msg":"success","data":{"skipStart":85,"skipEnd":120}}');
    const [call] = nas.requests;
    assert.equal(call.path, '/v/api/v1/play/info');
    assert.equal(call.headers.authorization, 'nas-token');
    assert.match(call.headers.cookie, /gateway=granted/);
    assert.equal(JSON.parse(call.body).item_guid, 'item-1');
});

test('GET skipinfo reports 0 for skip points the NAS leaves null or out', async (t) => {
    const nas = await startFakeFnMedia(t, {
        playInfo: { 'item-1': playInfo(null, null), 'item-2': { guid: 'item-2', parent_guid: 'season-1', play_config: {} } },
    });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas, { itemGuids: ['item-1', 'item-2'] }));

    for (const item of ['item-1', 'item-2']) {
        const response = await get(service, `/api/v1/skipinfo/${item}?session=${session}`);
        assert.equal(response.body.toString(), '{"code":0,"msg":"success","data":{"skipStart":0,"skipEnd":0}}', item);
    }
});

test('GET skipinfo reads the NAS every time instead of caching', async (t) => {
    const info = playInfo(10, 20);
    const nas = await startFakeFnMedia(t, { playInfo: { 'item-1': info } });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    await get(service, `/api/v1/skipinfo/item-1?session=${session}`);
    info.play_config.skip_opening = 30;
    const second = await get(service, `/api/v1/skipinfo/item-1?session=${session}`);

    assert.equal(JSON.parse(second.body.toString()).data.skipStart, 30);
    assert.equal(nas.requests.length, 2);
});

test('GET skipinfo without a session is rejected with 400', async (t) => {
    const nas = await startFakeFnMedia(t, { playInfo: { 'item-1': playInfo(10, 20) } });
    const { service } = await startProxy(t);

    for (const query of ['', '?session=']) {
        const response = await get(service, `/api/v1/skipinfo/item-1${query}`);
        assert.equal(response.status, 400, query);
        assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
        assert.equal(response.body.toString(), '{"code":1000,"msg":"Missing required parameters"}');
    }
    assert.equal(nas.requests.length, 0);
});

test('GET skipinfo with an unknown session or an item outside the session is rejected with 401', async (t) => {
    const nas = await startFakeFnMedia(t, { playInfo: { 'item-1': playInfo(10, 20), 'item-2': playInfo(10, 20) } });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    for (const requestPath of [`/api/v1/skipinfo/item-1?session=${'0'.repeat(64)}`, `/api/v1/skipinfo/item-2?session=${session}`]) {
        const response = await get(service, requestPath);
        assert.equal(response.status, 401, requestPath);
        assert.equal(response.body.toString(), '{"code":1000,"msg":"Invalid playback session"}');
    }
    assert.equal(nas.requests.length, 0);
});

test('GET skipinfo rejects an expired session and each use extends it', async (t) => {
    const nas = await startFakeFnMedia(t, { playInfo: { 'item-1': playInfo(10, 20) } });
    const { service } = await startProxy(t);
    t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 0, 1) });
    const hour = 60 * 60 * 1000;
    const session = service.createPlaybackSession(sessionInput(nas));
    const read = () => get(service, `/api/v1/skipinfo/item-1?session=${session}`);

    t.mock.timers.tick(23 * hour);
    assert.equal((await read()).status, 200);
    t.mock.timers.tick(24 * hour);
    assert.equal((await read()).status, 200);
    t.mock.timers.tick(24 * hour + 1);
    assert.equal((await read()).status, 401);
});

test('GET skipinfo answers 500 when the NAS reports a failure or cannot be reached', async (t) => {
    const failing = await startFakeFnMedia(t, { playInfo: {} });
    const unreachable = await startFakeFnMedia(t, { handlers: { playInfo: (req) => req.socket.destroy() } });
    const { service } = await startProxy(t);

    for (const nas of [failing, unreachable]) {
        const session = service.createPlaybackSession(sessionInput(nas));
        const response = await get(service, `/api/v1/skipinfo/item-1?session=${session}`);
        assert.equal(response.status, 500);
        assert.equal(response.body.toString(), '{"code":1000,"msg":"Failed to get skip info"}');
    }
});

test('GET skipinfo ignores an ItemGuid in the query and checks the session against the path', async (t) => {
    const nas = await startFakeFnMedia(t, { playInfo: { 'item-1': playInfo(10, 20), 'item-2': playInfo(30, 40) } });
    const { service } = await startProxy(t);
    const onlyItem1 = service.createPlaybackSession(sessionInput(nas));
    const onlyItem2 = service.createPlaybackSession(sessionInput(nas, { itemGuids: ['item-2'] }));

    const allowed = await get(service, `/api/v1/skipinfo/item-1?session=${onlyItem1}&ItemGuid=item-2&itemGuid=item-2`);
    const rejected = await get(service, `/api/v1/skipinfo/item-1?session=${onlyItem2}&ItemGuid=item-2&itemGuid=item-2`);

    assert.equal(JSON.parse(allowed.body.toString()).data.skipStart, 10);
    assert.equal(rejected.status, 401);
    assert.deepEqual(nas.requests.map((r) => JSON.parse(r.body).item_guid), ['item-1']);
});

test('a trailing slash on the skipinfo route redirects to the path without it', async (t) => {
    const { service } = await startProxy(t);

    const response = await get(service, '/api/v1/skipinfo/item-1/?session=abc');

    assert.equal(response.status, 301);
    assert.equal(response.headers.location, '/api/v1/skipinfo/item-1?session=abc');
});
